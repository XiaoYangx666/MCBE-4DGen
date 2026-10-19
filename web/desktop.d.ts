export {};
declare global {
 interface DesktopWindowState {maximized:boolean;fullscreen:boolean;focused:boolean}
 interface Window {desktop?:{
 chooseDirectory(kind:'game'|'data',initial:string):Promise<{path:string|null}>;
 palette(value?:'graphite'|'ocean'|'sand'|'rose'|'violet'):Promise<'graphite'|'ocean'|'sand'|'rose'|'violet'>;
 appearance(value?:'system'|'light'|'dark'):Promise<'system'|'light'|'dark'>;
 restart():Promise<boolean>;
 windowState():Promise<DesktopWindowState>;
 windowAction(action:'minimize'|'maximize'|'close'|'menu'):Promise<void>;
 onWindowState(callback:(state:DesktopWindowState)=>void):()=>void;
 onAbout(callback:()=>void):()=>void;
 }}
}
