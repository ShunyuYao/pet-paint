'use strict';
// Opens the unmodified built HTML (no preload, no pet SDK) in a hidden Chromium window.
const {app,BrowserWindow}=require('electron');
if(!process.env.PAINT_E2E_PROFILE?.includes('pet-paint-e2e-')||!process.env.PAINT_HTML)throw Error('isolated test only');
app.setPath('userData',process.env.PAINT_E2E_PROFILE);
app.whenReady().then(()=>{
  const w=new BrowserWindow({show:false,width:+process.env.PAINT_W||960,height:+process.env.PAINT_H||656,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  w.loadFile(process.env.PAINT_HTML);
});
app.on('window-all-closed',()=>app.quit());
