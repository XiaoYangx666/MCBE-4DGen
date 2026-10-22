import {packager} from '@electron/packager';
import {readFile} from 'node:fs/promises';
const options=JSON.parse(await readFile(process.argv[2],'utf8'));
options.ignore=[/^\/payload(?:\/|$)/];
console.log((await packager(options)).join('\n'));
