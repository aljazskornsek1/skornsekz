import fs from "node:fs";
import path from "node:path";

const root=path.resolve("work/blank-canvas");
const source=fs.readFileSync(path.resolve("work/current-site/index.html"),"utf8");
let template=fs.readFileSync(path.join(root,"template.html"),"utf8");
const translations=JSON.parse(fs.readFileSync(path.join(root,"translations.json"),"utf8"));
const start=source.indexOf("    const privateCats =");
const end=source.indexOf("    const app =",start);
if(start<0||end<0)throw new Error("Content model not found");
const data=source.slice(start,end).replace(/https:\/\/images\.unsplash\.com\/[^'\"]+/g,"about:blank");
const embedded=[...source.matchAll(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g)].map(x=>x[0]);
if(!embedded.length)throw new Error("Brand image not found");
const assetDir=path.resolve("work/financial-v2/assets-minimal");
const optimizedAssetDir=path.join(root,"assets");
const outputAssetDir=path.resolve("outputs/assets");
fs.rmSync(outputAssetDir,{recursive:true,force:true});
fs.mkdirSync(outputAssetDir,{recursive:true});
function fileDataUrl(filePath){
  const ext=path.extname(filePath).toLowerCase();
  const mime=ext===".png"?"image/png":ext===".webp"?"image/webp":"image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}
const names=["hero","business","home","mobility","health","travel","legal","cyber"];
const images={};
for(const name of names){
  const optimized=fs.existsSync(optimizedAssetDir)?fs.readdirSync(optimizedAssetDir).find(x=>path.parse(x).name===name):null;
  const file=optimized||fs.readdirSync(assetDir).find(x=>path.parse(x).name===name);
  if(!file)throw new Error(`Missing image: ${name}`);
  const sourceFile=path.join(optimized?optimizedAssetDir:assetDir,file);
  fs.copyFileSync(sourceFile,path.join(outputAssetDir,file));
  images[name]=fileDataUrl(sourceFile);
}
// Keep all people-oriented placements calm and architectural: no anonymous stock-photo teams.
images.people=images.home;
const productNatureFile=path.join(optimizedAssetDir,"product-nature-v1.jpg");
if(!fs.existsSync(productNatureFile))throw new Error("Missing product nature image");
fs.copyFileSync(productNatureFile,path.join(outputAssetDir,"product-nature-v1.jpg"));
images.productNature=fileDataUrl(productNatureFile);
const vehicleImageFiles={
  "vozila-avtomobil":"vehicle-car-v1.jpg",
  "vozila-mladi-voznik":"vehicle-young-driver-v1.jpg",
  "vozila-motor":"vehicle-motorcycle-v1.jpg",
  "vozila-avtodom":"vehicle-motorhome-v1.jpg",
  "vozila-mikro-mobilnost":"vehicle-micro-v1.jpg",
  "vozila-vodna-plovila":"vehicle-watercraft-v1.jpg"
};
const vehicleGroupImages={};
for(const [key,file] of Object.entries(vehicleImageFiles)){
  const sourceFile=path.join(optimizedAssetDir,file);
  if(!fs.existsSync(sourceFile))throw new Error(`Missing vehicle image: ${file}`);
  fs.copyFileSync(sourceFile,path.join(outputAssetDir,file));
  vehicleGroupImages[key]=fileDataUrl(sourceFile);
}
const vehicleGroupCss=Object.entries(vehicleGroupImages).map(([key,image])=>`html body[data-page="${key}"] .pb-product-hero:before{background-image:url('${image}')!important}`).join("\n");
function writeEmbeddedAsset(dataUrl,name){
  const match=dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if(!match)throw new Error(`Invalid embedded asset: ${name}`);
  const ext=match[1]==="jpeg"?"jpg":match[1];
  const file=`${name}.${ext}`;
  fs.writeFileSync(path.join(outputAssetDir,file),Buffer.from(match[2],"base64"));
  return `assets/${file}`;
}
const optimizedLogo=path.join(optimizedAssetDir,"logo-original-mark.png");
const logo=fs.existsSync(optimizedLogo)?(fs.copyFileSync(optimizedLogo,path.join(outputAssetDir,"logo.png")),fileDataUrl(optimizedLogo)):embedded[0];
const profile=embedded[1]||embedded[0];
template=template.replace("__DATA__",data).replaceAll("__LOGO__",logo).replaceAll("__PROFILE__",profile).replaceAll("__PRODUCT_NATURE__",images.productNature).replace("__VEHICLE_GROUP_CSS__",vehicleGroupCss).replace("__IMAGES__",JSON.stringify(images)).replace("__TRANSLATIONS__",JSON.stringify(translations));
const out=path.resolve("outputs/zavarovanje-skornsek-nova-agencijska-stran.html");
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,template);
fs.writeFileSync(path.resolve("outputs/index.html"),template);
console.log(out);
