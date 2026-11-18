// STUB menu — replaced by the menu/UI agent. API: createMenu(ctx) -> { update(dt), open(), close(), isOpen }
export async function createMenu(ctx) {
  const menu = { isOpen: false, update() {}, open() {}, close() {} };
  if (!ctx.params.autostart) {
    const b = document.createElement('button'); b.id = 'stub-fly'; b.textContent = 'Fly';
    b.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:600 20px var(--font-display);padding:12px 40px;background:var(--accent);color:#000;border:0;cursor:pointer';
    b.onclick = () => { ctx.session.start({}); ctx.audio.resume?.(); b.remove(); };
    ctx.uiRoot.appendChild(b);
  }
  return menu;
}
