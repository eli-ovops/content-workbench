import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const BASE=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const config=JSON.parse(fs.readFileSync(path.join(BASE,'workspace.json'),'utf8'));
if(config.schemaVersion!==1||typeof config.root!=='string'||path.isAbsolute(config.root)||config.root.split('/').includes('..')||typeof config.rootId!=='string')throw new Error('默认工作空间配置错误，停止启动');
export const DEFAULT_ROOT=path.join(BASE,config.root);export const DEFAULT_ROOT_ID=config.rootId;
