import { IApi } from '@umijs/types';
import fs from 'fs';
const { ModuleFederationPlugin } = require('webpack').container;

const promiseStyleRemotes = (name: string, exposeName: string) => {
  return `promise new Promise(async (resolve) => {
    // 远程库的地址,除了uat和prod环境都采用dev
    const remoteBaseUrl = {
      dev: 'https://mpdev.jus-link.com/mf/',
      prod: 'https://mp.juslink.com/mf/'
    }
    const { cfgType } = window.jusdaBaseConfig // 获取当前环境
    let scriptSrc = remoteBaseUrl['dev']
    if (['uat', 'prod'].includes(cfgType)) {
      scriptSrc = remoteBaseUrl['prod']
    }
    const scriptLoaded = function() {
      return new Promise((resolve) => {
      const tempScript = document.createElement('script')
      tempScript.src = scriptSrc + '${name}.js'
      document.head.appendChild(tempScript)
      tempScript.onload = () => {
        resolve(true)
      }
      tempScript.onerror = () => {
        document.head.removeChild(tempScript)
        resolve(false)
      }
    })}
    const result = await scriptLoaded()
    const script = document.createElement('script')
    if (result) {
      const proxy = {
        get: (req) => window.${name}.get(req),
        init: (arg) => {
          try {
            return window.${name}.init(arg)
          } catch (e) {
            console.log('remote container already initialized')
          }
        }
      }
      resolve(proxy)
    } else {
      const { origin } = window.location;
      script.src = origin + '/${exposeName}.js'
      script.onload = () => {
        const proxy = {
          get: (req) => window.${exposeName}.get(req),
          init: (arg) => {
            try {
              return window.${exposeName}.init(arg)
            } catch (e) {
              console.log('remote container already initialized')
            }
          }
        }
        resolve(proxy)
      }
    }
    document.head.appendChild(script)
  })`;
};

export default function (api: IApi) {
  api.describe({
    key: 'mf',
    config: {
      default: null,
      schema(joi) {
        // 配置项
        return joi.object({
          name: joi.string(), // 暴露给远程使用的名称
          exposes: joi.object(), // 暴露的配置
          remotes: joi.alternatives(joi.object(), joi.array()), // 使用远程的配置
          deps: joi.object(), // package.json中的dependencies
        });
      },
      onChange: api.ConfigChangeType.regenerateTmpFiles,
    },
    enableBy: api.EnableBy.config,
  });
  if (api.userConfig.mf) {
    // 生成一份在引入js失败时可用的导出文件
    // 目前发现使用umi.writeTempFile生成临时文件 会出现webpack找不到文件，编译不成功的问题 改为采用node的fs
    api.onGenerateFiles(() => {
      fs.stat('./src/mf-error/index.tsx', (e) => {
        if (e !== null) { // 获取到文件则返回null，现在只有在null才不创建
          fs.mkdir('./src/mf-error/', { recursive: false }, () => {
            const fileContent = `import React from 'react';
          export default function Error() {
            return (
              <h4>{'组件加载失败了>_<!!'}</h4>
            )
          }`;
            fs.writeFileSync('./src/mf-error/index.tsx', fileContent); // 放置错误文件的路径
          });
        }
      })
    });
    // 注册异步启动插件
    api.registerPlugins([
      {
        id: 'mf-bootstrap',
        key: 'umi-plugin-async-bootstrap',
        apply: () => () => { },
        path: require.resolve('umi-plugin-async-bootstrap'),
      },
      require.resolve('umi-plugin-async-bootstrap'),
    ]);
    // 设置要消费或者远程载入的组件chainWebpack配置
    api.chainWebpack(config => {
      // 设置publicPath为自动
      config.output.publicPath('auto');
      const { mf } = api.userConfig;
      const {
        exposes, // 暴露的配置
        remotes, // 使用远程的配置
        name, // 插件名
        deps,
      } = mf;
      let dealWithRemotes = {}; // 对传入的remotes字段处理
      if (remotes instanceof Array) {
        // 如果是数组类型则自动注入每一个组件
        for (let item of remotes) {
          let temp = {};
          temp[item] = promiseStyleRemotes(item, name);
          dealWithRemotes = {
            ...dealWithRemotes,
            ...temp,
          };
        }
      } else {
        // 对象模式可用于开发调试，其他时候均采用数组传入
        dealWithRemotes = remotes || {};
      }
      const configs = {
        name,
        filename: `${name}.js`,
        exposes: {
          './error': './src/mf-error',
          ...exposes,
        },
        remotes: dealWithRemotes,
        shared: {
          react: {
            singleton: true,
            eager: true,
            requiredVersion: '17.x',
          },
          'react-dom': {
            singleton: true,
            eager: true,
            requiredVersion: '17.x',
          },
        },
      };
      if (deps) configs.shared = { ...configs.shared, ...deps }
      config.plugin(name).use(ModuleFederationPlugin, [configs]);
      return config;
    });
  }
}
