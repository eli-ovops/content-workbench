import {DEFAULT_ROOT} from './default-workspace.mjs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {Store} from './store.mjs';import {demoWorkspace} from './fixture.mjs';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const root=process.argv[2]||DEFAULT_ROOT;await new Store(root).init([demoWorkspace()]);console.log(JSON.stringify({initialized:true,root,kind:'SYNTHETIC_ONLY'}));
