// STUB camera rig — replaced by the camera agent. API: createCameraRig(ctx) -> { mode, modes, setMode(m), update(dt), worldPosition }
import * as THREE from 'three';
export async function createCameraRig(ctx) {
  const cam = ctx.camera, pos = new THREE.Vector3(), tgt = new THREE.Vector3(), off = new THREE.Vector3(), q = new THREE.Quaternion();
  const rig = {
    mode: 'chase', modes: ['chase', 'cockpit'], worldPosition: new THREE.Vector3(),
    setMode(m) { if (rig.modes.includes(m)) { rig.mode = m; ctx.events.emit('camera:mode', m); } },
    update(dt) {
      const p = ctx.player; if (!p) { cam.position.set(0, 300, 600); cam.lookAt(0, 0, 0); return; }
      const g = p.def.geometry; ctx.world.toRender(p.state.position, tgt);
      if (rig.mode === 'cockpit') {
        off.fromArray(g.pilotEye).applyQuaternion(p.state.quaternion); cam.position.copy(tgt).add(off); cam.quaternion.copy(p.state.quaternion);
      } else {
        // heading-only follow
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -p.state.heading);
        off.set(0, g.length * 0.35, g.length * 2.2).applyQuaternion(q);
        cam.position.copy(tgt).add(off); cam.lookAt(tgt);
      }
      ctx.world.toWorld(cam.position, rig.worldPosition);
    },
  };
  ctx.events.on('cmd', ({ name }) => { if (name === 'cameraNext') rig.setMode(rig.modes[(rig.modes.indexOf(rig.mode) + 1) % rig.modes.length]); });
  return rig;
}
