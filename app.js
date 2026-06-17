import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';

const viewer = document.getElementById('viewer');
const hudText = document.getElementById('hudText');
const modelStatus = document.getElementById('modelStatus');
const markerStatus = document.getElementById('markerStatus');
const generateStatus = document.getElementById('generateStatus');
const exportStatus = document.getElementById('exportStatus');

let scene, camera, renderer, controls;
let importedRoot = null;
let generatedRoot = new THREE.Group();
generatedRoot.name = 'Cloud_Face_Editor_Generated_Face_Parts';
let markerRoot = new THREE.Group();
markerRoot.name = 'Cloud_Face_Editor_Markers';
let activeMarker = null;
let markers = {};
let modelMeshes = [];
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let modelBounds = new THREE.Box3();
let modelCenter = new THREE.Vector3();
let modelSize = new THREE.Vector3(1,1,1);

init();
wireUI();
animate();

function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2ead4);
  scene.add(generatedRoot);
  scene.add(markerRoot);

  camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.01, 1000);
  camera.position.set(0, 1.6, 5);

  renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  viewer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.3, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x363636, 2.2);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 6, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd2aa, 1.1);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const grid = new THREE.GridHelper(10, 10, 0x111111, 0x9b6b4f);
  grid.material.opacity = 0.22;
  grid.material.transparent = true;
  scene.add(grid);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function wireUI(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('modelInput').addEventListener('change', handleModelInput);
  document.getElementById('frontView').addEventListener('click', ()=>setCameraView('front'));
  document.getElementById('sideView').addEventListener('click', ()=>setCameraView('side'));
  document.getElementById('resetView').addEventListener('click', fitCameraToModel);

  document.querySelectorAll('.marker-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      activeMarker = btn.dataset.marker;
      document.querySelectorAll('.marker-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      markerStatus.textContent = 'Active marker: ' + markerLabel(activeMarker) + '. Click the face on the model.';
      hudText.textContent = 'PLACE ' + markerLabel(activeMarker).toUpperCase();
    });
  });

  document.getElementById('clearMarkers').addEventListener('click', clearMarkers);
  document.getElementById('generateFace').addEventListener('click', generateFaceParts);
  document.getElementById('deleteFace').addEventListener('click', clearGeneratedFace);
  document.getElementById('exportGLB').addEventListener('click', exportGLB);

  ['eyeColor','browColor','mouthColor','patchColor','eyeSize','mouthSize','usePatch'].forEach(id=>{
    document.getElementById(id).addEventListener('input',()=>{
      if(generatedRoot.children.length) generateFaceParts();
    });
  });
}

async function handleModelInput(e){
  const file = e.target.files?.[0];
  if(!file) return;
  modelStatus.textContent = 'Loading ' + file.name + '...';
  hudText.textContent = 'LOADING MODEL...';
  const arrayBuffer = await file.arrayBuffer();
  const loader = new GLTFLoader();
  loader.parse(arrayBuffer, '', gltf=>{
    if(importedRoot) scene.remove(importedRoot);
    clearMarkers();
    clearGeneratedFace();
    importedRoot = gltf.scene;
    importedRoot.name = 'Imported_AI_Model';
    scene.add(importedRoot);
    prepareModel(importedRoot);
    fitCameraToModel();
    modelStatus.textContent = 'Imported: ' + file.name + ' | Meshes found: ' + modelMeshes.length;
    hudText.textContent = 'MODEL LOADED - PLACE FACE MARKERS';
    exportStatus.textContent = 'Model loaded. Add markers/face parts, then export.';
  }, error=>{
    console.error(error);
    modelStatus.textContent = 'Import failed. Check console. Try a binary .glb file.';
    hudText.textContent = 'IMPORT FAILED';
  });
}

function prepareModel(root){
  modelMeshes = [];
  root.traverse(obj=>{
    if(obj.isMesh){
      modelMeshes.push(obj);
      obj.castShadow = true;
      obj.frustumCulled = false;
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m=>{
          if(m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.side = THREE.DoubleSide;
        });
      }
    }
  });
  modelBounds.setFromObject(root);
  modelBounds.getCenter(modelCenter);
  modelBounds.getSize(modelSize);
}

function onPointerDown(event){
  if(!activeMarker || !importedRoot){ return; }
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(modelMeshes, true);
  if(!hits.length){
    markerStatus.textContent = 'No mesh hit. Rotate/zoom closer and click directly on the face.';
    return;
  }
  const hit = hits[0];
  const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  setMarker(activeMarker, hit.point.clone(), worldNormal);
  markerStatus.textContent = markerLabel(activeMarker) + ' placed. Markers placed: ' + Object.keys(markers).length;
  hudText.textContent = markerLabel(activeMarker).toUpperCase() + ' PLACED';
}

function setMarker(type, position, normal){
  if(markers[type]?.visual) markerRoot.remove(markers[type].visual);
  const color = markerColor(type);
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(modelSize.y * 0.012, 0.025), 24, 12),
    new THREE.MeshBasicMaterial({ color })
  );
  sphere.name = 'Marker_' + type;
  sphere.position.copy(position).add(normal.clone().multiplyScalar(Math.max(modelSize.y * 0.006, 0.012)));
  markerRoot.add(sphere);
  markers[type] = { position: position.clone(), normal: normal.clone(), visual: sphere };
}

function clearMarkers(){
  markers = {};
  while(markerRoot.children.length) markerRoot.remove(markerRoot.children[0]);
  markerStatus.textContent = 'Markers cleared.';
}

function clearGeneratedFace(){
  while(generatedRoot.children.length){
    const child = generatedRoot.children[0];
    generatedRoot.remove(child);
  }
  generateStatus.textContent = 'Generated face parts cleared.';
}

function generateFaceParts(){
  if(!markers.leftEye || !markers.rightEye || !markers.mouth){
    generateStatus.textContent = 'Need left eye, right eye, and mouth markers first.';
    return;
  }
  clearGeneratedFace();

  const eyeColor = document.getElementById('eyeColor').value;
  const browColor = document.getElementById('browColor').value;
  const mouthColor = document.getElementById('mouthColor').value;
  const patchColor = document.getElementById('patchColor').value;
  const eyeSize = parseFloat(document.getElementById('eyeSize').value) * modelSize.y;
  const mouthSize = parseFloat(document.getElementById('mouthSize').value) * modelSize.y;

  const faceNormal = averageNormal([markers.leftEye, markers.rightEye, markers.mouth]);
  const right = markers.rightEye.position.clone().sub(markers.leftEye.position).normalize();
  const up = new THREE.Vector3().crossVectors(right, faceNormal).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, faceNormal));

  if(document.getElementById('usePatch').checked){
    const eyeDistance = markers.leftEye.position.distanceTo(markers.rightEye.position);
    const patchCenter = markers.leftEye.position.clone().add(markers.rightEye.position).multiplyScalar(0.5).lerp(markers.mouth.position, 0.42);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(eyeDistance * 1.65, Math.max(eyeDistance * 1.1, mouthSize * 1.2), 1, 1),
      new THREE.MeshToonMaterial({ color: patchColor, side: THREE.DoubleSide })
    );
    patch.name = 'Cloud_Face_Skin_Cover_Patch';
    patch.quaternion.copy(q);
    patch.position.copy(patchCenter).add(faceNormal.clone().multiplyScalar(modelSize.y * 0.012));
    generatedRoot.add(patch);
  }

  const leftEye = makeAnimeEye('Left_Separate_Anime_Eye', eyeColor, eyeSize);
  leftEye.position.copy(markers.leftEye.position).add(markers.leftEye.normal.clone().multiplyScalar(modelSize.y * 0.025));
  leftEye.quaternion.copy(q);
  generatedRoot.add(leftEye);

  const rightEye = makeAnimeEye('Right_Separate_Anime_Eye', eyeColor, eyeSize);
  rightEye.position.copy(markers.rightEye.position).add(markers.rightEye.normal.clone().multiplyScalar(modelSize.y * 0.025));
  rightEye.quaternion.copy(q);
  generatedRoot.add(rightEye);

  if(markers.leftBrow){
    const lb = makeBrow('Left_Separate_Brow', browColor, eyeSize * 1.3);
    lb.position.copy(markers.leftBrow.position).add(markers.leftBrow.normal.clone().multiplyScalar(modelSize.y * 0.025));
    lb.quaternion.copy(q); generatedRoot.add(lb);
  }
  if(markers.rightBrow){
    const rb = makeBrow('Right_Separate_Brow', browColor, eyeSize * 1.3);
    rb.position.copy(markers.rightBrow.position).add(markers.rightBrow.normal.clone().multiplyScalar(modelSize.y * 0.025));
    rb.quaternion.copy(q); generatedRoot.add(rb);
  }

  const mouth = makeMouth('Separate_Anime_Mouth', mouthColor, mouthSize);
  mouth.position.copy(markers.mouth.position).add(markers.mouth.normal.clone().multiplyScalar(modelSize.y * 0.03));
  mouth.quaternion.copy(q);
  generatedRoot.add(mouth);

  generateStatus.textContent = 'Generated separate eyes, mouth' + (document.getElementById('usePatch').checked ? ', and face patch.' : '.');
  hudText.textContent = 'FACE PARTS GENERATED';
}

function makeAnimeEye(name, color, size){
  const group = new THREE.Group(); group.name = name;
  const white = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 16), new THREE.MeshToonMaterial({ color: 0xf7efe5 }));
  white.name = name + '_White'; white.scale.set(1.1, 1.55, 0.12); group.add(white);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(size * 0.48, 32, 16), new THREE.MeshToonMaterial({ color }));
  iris.name = name + '_Iris'; iris.position.z = size * 0.13; iris.scale.set(1, 1.35, 0.08); group.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(size * 0.18, 16, 8), new THREE.MeshBasicMaterial({ color: 0x090909 }));
  pupil.name = name + '_Pupil'; pupil.position.z = size * 0.2; pupil.scale.set(1, 1.45, 0.05); group.add(pupil);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(size * 0.1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  shine.name = name + '_Highlight'; shine.position.set(-size * 0.16, size * 0.24, size * 0.24); shine.scale.set(1, 1, 0.05); group.add(shine);
  return group;
}

function makeBrow(name, color, width){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, width * 0.16, width * 0.08), new THREE.MeshToonMaterial({ color }));
  mesh.name = name;
  return mesh;
}

function makeMouth(name, color, size){
  const group = new THREE.Group(); group.name = name;
  const smile = new THREE.Mesh(new THREE.TorusGeometry(size * 0.45, size * 0.045, 8, 32, Math.PI), new THREE.MeshBasicMaterial({ color }));
  smile.name = name + '_Curve';
  smile.rotation.z = Math.PI;
  smile.scale.y = 0.45;
  group.add(smile);
  const open = new THREE.Mesh(new THREE.SphereGeometry(size * 0.22, 24, 12), new THREE.MeshBasicMaterial({ color }));
  open.name = name + '_Open_Mouth_Shape_Hidden';
  open.scale.set(1, 1.35, 0.16);
  open.visible = false;
  group.add(open);
  return group;
}

function averageNormal(items){
  const n = new THREE.Vector3();
  items.forEach(i=>n.add(i.normal));
  if(n.lengthSq() < 0.0001) n.set(0,0,1);
  return n.normalize();
}

function markerColor(type){
  return { leftEye:0x00d9ff, rightEye:0x00d9ff, mouth:0xff004d, leftBrow:0xffff00, rightBrow:0xffff00 }[type] || 0xffffff;
}
function markerLabel(type){
  return { leftEye:'Left Eye', rightEye:'Right Eye', mouth:'Mouth', leftBrow:'Left Brow', rightBrow:'Right Brow' }[type] || 'None';
}

function setCameraView(view){
  if(!importedRoot) return;
  const radius = Math.max(modelSize.x, modelSize.y, modelSize.z) * 1.8;
  if(view === 'front') camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + radius);
  if(view === 'side') camera.position.set(modelCenter.x + radius, modelCenter.y, modelCenter.z);
  controls.target.copy(modelCenter);
  controls.update();
}

function fitCameraToModel(){
  if(!importedRoot){
    camera.position.set(0,1.6,5); controls.target.set(0,1.2,0); controls.update(); return;
  }
  modelBounds.setFromObject(importedRoot);
  modelBounds.getCenter(modelCenter);
  modelBounds.getSize(modelSize);
  const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
  const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI / 180) / 2));
  camera.position.set(modelCenter.x, modelCenter.y + modelSize.y * 0.1, modelCenter.z + dist * 1.6);
  camera.near = Math.max(0.001, dist / 100);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(modelCenter);
  controls.update();
}

function exportGLB(){
  if(!importedRoot){ exportStatus.textContent = 'Import a model first.'; return; }
  const exportScene = new THREE.Scene();
  exportScene.name = 'Cloud_Face_Editor_Export';
  exportScene.add(importedRoot.clone(true));
  exportScene.add(generatedRoot.clone(true));
  const exporter = new GLTFExporter();
  exportStatus.textContent = 'Exporting...';
  exporter.parse(exportScene, result=>{
    const blob = new Blob([result], { type:'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloud_face_fixed.glb';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    exportStatus.textContent = 'Exported cloud_face_fixed.glb';
  }, err=>{
    console.error(err);
    exportStatus.textContent = 'Export failed. Check console.';
  }, { binary:true });
}

function onResize(){
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
}
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
