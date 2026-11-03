const moment = require("moment");
class TAbstractFile {}
class TFile extends TAbstractFile { constructor(path){super(); this.path=path; this.extension=path.split('.').pop(); const d=path.split('/').slice(0,-1).join('/'); this.parent={path: d||'/'}; } }
const files = new Map(); const created = [];
const vault = { getAbstractFileByPath: (p)=> files.get(p) ?? (dirs.has(p)?{}:null), on: ()=>({}),
  create: async (p,b)=>{ const f=new TFile(p); files.set(p,f); f.body=b; created.push([p,b]); return f; },
  read: async (f)=> f.body ?? "", createFolder: async (p)=>{ dirs.add(p); } };
const dirs = new Set();
let opened = [];
const workspace = { getLeaf: ()=>({ openFile: async (f)=>opened.push(f.path) }), getActiveFile: ()=>workspace._active, getLeavesOfType: ()=>[], onLayoutReady: ()=>{}, getRightLeaf:()=>null, revealLeaf(){} };
class Plugin { constructor(){ this.app={vault,workspace}; } loadData(){return Promise.resolve(this._data)} saveData(d){this._data=d;return Promise.resolve()} registerView(){} addRibbonIcon(){} addCommand(c){(this.cmds??=[]).push(c)} addSettingTab(){} registerEvent(){} registerInterval(){} }
class ItemView { constructor(leaf){ this.leaf=leaf; this.containerEl=document.createElement('div'); this.containerEl.appendChild(document.createElement('div')); this.containerEl.appendChild(document.createElement('div')); } }
class PluginSettingTab {}
class Setting {}
const notices=[]; class Notice { constructor(t){notices.push(t)} }
globalThis.__mock = module.exports = { moment, TFile, TAbstractFile, Plugin, ItemView, PluginSettingTab, Setting, Notice, WorkspaceLeaf: class{},
  normalizePath: (p)=>p.replace(/\/+/g,'/').replace(/^\/|\/$/g,'') || '/', requestUrl: async()=>({json:{}}), App: class{},
  __t: { files, created, opened, notices, workspace, dirs } };
