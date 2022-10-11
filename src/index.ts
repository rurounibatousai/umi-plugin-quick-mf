import { IApi } from '@umijs/types';
import { Schema, Root } from '@umijs/deps/compiled/@hapi/joi';
import fs from 'fs';
import WebpackChain from 'webpack-chain';

const setRemotesValuePromiseStyle = (usingComponentName: string): string => {
  return `promise new Promise(async (resolve) => {
    const remoteBaseUrl = { // 远程库的地址,beta环境采用dev
      prod: 'https://mp.jus-link.com/mf/',
      sit: 'https://mpsit.jus-link.com/mf/',
      uat: 'https://mpuat.jus-link.com/mf/',
      dev: 'https://mpdev.jus-link.com/mf/',
    }
    
    const setRemoteBaseUrl = () => { // 通过cfgType来返回远端js的基础地址
      const { cfgType, mfUrl } = window.jusdaBaseConfig;
      if (mfUrl) return mfUrl;
      return remoteBaseUrl[cfgType] || remoteBaseUrl['dev'];
    }
    
    const checkScriptPreLoadResult = (usingComponentName) => { // 预先加载将要加载的js，无论成功还是失败都resolve，只是成功是true，失败是false
      return new Promise((resolve) => {
        const tempScript = document.createElement('script');
        tempScript.src = setRemoteBaseUrl() + usingComponentName + 'Entry.js'
        document.head.appendChild(tempScript);
        tempScript.onload = () => {
          resolve(true);
        };
        tempScript.onerror = () => {
          document.head.removeChild(tempScript);
          resolve(false);
        }
      })
    }
    
    const checkIsFailed = () => { // 通过检查dom树中是否有重复的加载失败js来控制加载失败的js只加载一次
      const src = window.location.origin + '/jusdaMFErrorEntry.js';
      const collections = Array.from(document.querySelectorAll('script'));
      const result = collections.some(item => item.src === src);
      return result;
    }
    
    const resolveProxyObject = (usingComponentName) => {
      return {
        get: (req) => window[usingComponentName].get(req),
        init: (arg) => {
          try {
            return window[usingComponentName].init(arg)
          } catch (e) {
            console.log('remote container already initialized')
          }
        }
      }
    }
    
    const resolveProxyByPreLoadResult = async (usingComponentName) => {
      const preLoadResult = await checkScriptPreLoadResult(usingComponentName);
      let proxyResult = {};
      const script = document.createElement('script');
      if (preLoadResult) {
        proxyResult = resolveProxyObject(usingComponentName)
      } else if (!checkIsFailed()) {
        const { origin } = window.location;
        script.src = origin + '/jusdaMFErrorEntry.js'
        proxyResult = resolveProxyObject('jusdaMFError')
      } else {
        proxyResult = resolveProxyObject('jusdaMFError')
      }
      !preLoadResult && document.head.appendChild(script);
      return proxyResult;
    }

    const proxy = await resolveProxyByPreLoadResult('${usingComponentName}');
    resolve(proxy);
  })`;
};

const createFileForHandleRemoteFileFail = (): void => {
  // 生成一份在引入js失败时可用的导出文件
  fs.mkdir('./src/mf-error/', { recursive: false }, (): void => {
    const fileContent = `import React from 'react';
        export default function Error() {
          return (
            <h4>{'模块加载失败了>_<!!'}</h4>
          )
        }`;
    fs.writeFileSync('./src/mf-error/index.tsx', fileContent); // 放置错误文件的路径
  });
};

const createFilesForHandleErrorComponent = (): void => {
  // 生成一份内部处理获取js失败时的统一处理组件
  fs.mkdir(
    './src/components/dynamic-mf-components/',
    { recursive: true },
    (): void => {
      const fileContent = `import React, { CSSProperties, useEffect, useState } from 'react';
        // @ts-ignore
        const Error = React.lazy(() => import('jusdaMFError/Error'));
        
        const svgStyles: CSSProperties = {
          width: '100%',
          height: '30px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'absolute',
          zIndex: '2',
        };
        
        const svgCircleElementStyles = {
          stroke: '#ffc500',
        };
        
        const Loading = () => (
          <>
            <svg
              version="1.1"
              id="L3"
              xmlns="http://www.w3.org/2000/svg"
              xmlnsXlink="http://www.w3.org/1999/xlink"
              x="0px"
              y="0px"
              viewBox="0 0 100 100"
              enableBackground="new 0 0 0 0"
              xmlSpace="preserve"
              style={svgStyles}
            >
              <circle
                fill="none"
                stroke="#fff"
                strokeWidth="4"
                cx="50"
                cy="50"
                r="44"
                style={svgCircleElementStyles}
              />
              <circle
                fill="#fff"
                stroke="#e74c3c"
                strokeWidth="3"
                cx="8"
                cy="54"
                r="6"
                style={svgCircleElementStyles}
              >
                <animateTransform
                  attributeName="transform"
                  dur="2s"
                  type="rotate"
                  from="0 50 48"
                  to="360 50 52"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </>
        );
        
        // 传递想要加载的组件
        const DynamicMFComponents = (props: any) => {
            const { children } = props;
            const [shouldShowError, setShouldShowError] = useState(false);

            useEffect(() => {
                if (children.type._result.then) {
                    // 由于_result在最初加载时是一个promise则判断是否存在then方法
                    children.type._result.then(() => {
                        setShouldShowError(children.type._status !== 1);
                    });
                } else if (children.type._result === 'function') {
                    // 加载完毕之后_result是一个Module function
                    setShouldShowError(children.type._status !== 1);
                } else {
                    setShouldShowError(children.type._status !== 1);
                }
            }, [props]);

            return (
                <React.Suspense fallback={<Loading />}>
                    {shouldShowError ? <Error /> : children}
                </React.Suspense>
            );
        };

        export default DynamicMFComponents;
        `;
      fs.writeFileSync(
        './src/components/dynamic-mf-components/index.tsx',
        fileContent,
      ); // 放置错误文件的路径
    },
  );
};

// 将要注册的插件
const beRegisteredPlugins = [
  {
    id: 'mf-bootstrap',
    key: '@jusda-tools/umi-plugin-jusda-mf-bootstrap',
    apply: (): Function => (): void => {},
    path: require.resolve('@jusda-tools/umi-plugin-jusda-mf-bootstrap'),
  },
  require.resolve('@jusda-tools/umi-plugin-jusda-mf-bootstrap'),
];

const shared = {
  react: {
    singleton: true,
    eager: true,
    requiredVersion: '16.12.0',
  },
  'react-dom': {
    singleton: true,
    eager: true,
    requiredVersion: '16.12.0',
  },
};

interface ExposesToArray {
  name: string;
  shared: object;
  filename: string;
  exposes: object;
}

const setExposesFiledToArray = (exposes: {
  [key: string]: string;
}): ExposesToArray[] => {
  let exposesArray = [];
  let exposesComponentWithError = {
    './Error': './src/mf-error',
    ...exposes,
  };
  for (let key in exposesComponentWithError) {
    // key形似 './Button' value形似 './src/xx/xx'
    // 设置暴露出来的js名称为 key+'Entry.js' 全局变量名为：jusdaMF + key
    const tempKey = key.replace('./', '');
    const tempExposes = {};
    tempExposes[key] = exposesComponentWithError[key];
    exposesArray.push({
      name: `jusdaMF${tempKey}`,
      filename: `jusdaMF${tempKey}Entry.js`,
      exposes: {
        ...tempExposes,
      },
      shared,
    });
  }
  return exposesArray;
};

const setRemotesFieldToPromiseStyle = (
  remotes: object[] | string[] = [],
  name: string,
): object => {
  let dealWithRemotes = {};
  const remotesComponentWithError = [...remotes, 'Error'];
  for (let item of remotesComponentWithError) {
    if (typeof item === 'string') {
      let temp = {};
      temp[`jusdaMF${item}`] = setRemotesValuePromiseStyle(`jusdaMF${item}`);
      dealWithRemotes = {
        ...dealWithRemotes,
        ...temp,
      };
    } else if (typeof item === 'object') {
      dealWithRemotes = {
        ...dealWithRemotes,
        ...item,
      };
    }
  }
  return {
    name,
    remotes: dealWithRemotes,
    shared,
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setWebpackChain = (
  config: WebpackChain,
  api: IApi,
  webpack: any,
): WebpackChain => {
  config.output.publicPath('auto');
  const { ModuleFederationPlugin } = webpack.container;
  const { JusdaMF } = api.userConfig;
  const {
    exposes, // 暴露的配置
    remotes, // 使用远程的配置
    name, // 插件名
    deps,
  } = JusdaMF;
  const exposesComponents = setExposesFiledToArray(exposes);
  const remotesComponents = setRemotesFieldToPromiseStyle(remotes, name);
  // 根据exposes设置多个module-federation实例
  for (let item of exposesComponents) {
    if (deps) item.shared = { ...item.shared, ...deps };
    config.plugin(item.name).use(ModuleFederationPlugin, [item]);
  }
  // 单独设置一个remotes的module-federation实例
  config.plugin(name).use(ModuleFederationPlugin, [remotesComponents]);
  return config;
};

export default function (api: IApi): void {
  api.describe({
    key: 'JusdaMF',
    config: {
      default: null,
      schema(joi: Root): Schema {
        return joi.object({
          // 配置项
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

  if (api.userConfig.JusdaMF) {
    api.onGenerateFiles((): void => {
      createFileForHandleRemoteFileFail();
      createFilesForHandleErrorComponent();
    });
    api.registerPlugins(beRegisteredPlugins);
    api.chainWebpack(
      (config: WebpackChain, { webpack }): WebpackChain =>
        setWebpackChain(config, api, webpack),
    );
  }
}
