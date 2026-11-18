// Debug camera placement for screenshots (URL params, ignored unless present):
//   scam=x,y,z        camera at airport-local metres (east, height above field elevation, south)
//   slook=x,y,z       look-at target (airport-local), or shdg=deg & spitch=deg
//   srwy=27R,dist,h[,lat]  camera `dist` m before the named threshold (negative = down the runway), h m above the
//                     field, `lat` m to the right of the centreline, looking at the aiming point
//   sfov=deg          field of view
//   sap=KRDR          airport (default: params.airport or the player's airport)
// The camera rig has already run this frame, so we override the camera and refresh the frame uniforms it feeds.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export function setupDebugCamera(ctx, airports) {
  const raw = ctx.params.raw || {};
  if (!raw.scam && !raw.srwy) return null;
  const apId = raw.sap || ctx.params.airport || airports[0].id;
  const A = airports.find((a) => a.id === apId) || airports[0];
  const P = A.data.position, elev = A.data.elevation;
  const num = (s) => s.split(',').map(Number);
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), tmp = new THREE.Vector3();
  let hdg = null, pitch = 0;
  if (raw.srwy) {
    const [name, distS, hS, latS] = raw.srwy.split(',');
    const dist = +distS || 0, h = +hS || 2, lat = +latS || 0;
    let E = null, R = null;
    for (const r of A.layout.runways) for (const e of r.ends) if (e.name === name || e.digits + e.letter === name) { E = e; R = r; }
    if (!E) { R = A.layout.runways[0]; E = R.ends[0]; }
    const rt = { x: -E.left.x, z: -E.left.z };
    pos.set(P.x + E.thr.x - E.dir.x * dist + rt.x * lat, elev + h, P.z + E.thr.z - E.dir.z * dist + rt.z * lat);
    const aim = Math.max(R.aim || 300, 60);
    tgt.set(P.x + E.thr.x + E.dir.x * aim + rt.x * lat, elev, P.z + E.thr.z + E.dir.z * aim + rt.z * lat);
    if (raw.spitch !== undefined) { hdg = E.heading; pitch = +raw.spitch; }
  } else {
    const [x, y, z] = num(raw.scam);
    pos.set(P.x + x, elev + y, P.z + z);
    if (raw.slook) { const [lx, ly, lz] = num(raw.slook); tgt.set(P.x + lx, elev + ly, P.z + lz); }
    else { hdg = +(raw.shdg || 0); pitch = +(raw.spitch || 0); }
  }
  if (raw.sfov) { ctx.camera.fov = +raw.sfov; ctx.camera.updateProjectionMatrix(); }
  const u = ctx.uniforms.frame;
  return {
    update() {
      const cam = ctx.camera;
      ctx.world.toRender(pos, cam.position);
      if (hdg !== null) {
        const h = hdg * DEG, p = pitch * DEG;
        tmp.set(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)).add(cam.position);
        cam.lookAt(tmp);
      } else cam.lookAt(ctx.world.toRender(tgt, tmp));
      cam.updateMatrixWorld(true);
      u.uCameraPos.value.copy(cam.position);
      u.uCameraWorld.value.copy(cam.matrixWorld);
      u.uViewMatrix.value.copy(cam.matrixWorldInverse);
      u.uProjMatrix.value.copy(cam.projectionMatrix);
      u.uProjInverse.value.copy(cam.projectionMatrixInverse);
      if (ctx.cameraRig?.worldPosition) ctx.cameraRig.worldPosition.copy(pos);
    },
  };
}
