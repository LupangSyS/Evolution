/* หน้าการ์ดลักษณะ (ภาพ → ชื่อ → ประเภท → ผลของการ์ด) ใช้ร่วมกันระหว่างเกมและคลังภาพ */
(function (root) {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bg = (url) => (url ? ` style="background-image:url('${esc(url)}')"` : '');

  /** บรรทัดประเภท เช่น "ลักษณะ · นักล่า" */
  function typeLine(M, t) { return `ลักษณะ · ${M.groups[t.group].name}`; }

  /**
   * @param {object} M ข้อมูลเกม (traits, groups)
   * @param {(kind:string,id:string)=>string|null} artUrl
   * @param {object|null} c การ์ด {id, trait, food} หรือ null / {hidden:true} = หลังการ์ด
   * @param {{cls?:string, attrs?:string, mini?:boolean}} [o]
   */
  function card(M, artUrl, c, o = {}) {
    const cls = o.cls || '';
    const attrs = o.attrs || '';
    if (!c || !c.trait) {
      return `<div class="card cf back ${o.mini ? 'mini' : ''} ${cls}" ${attrs}${bg(artUrl('misc', 'back'))}></div>`;
    }
    const t = M.traits[c.trait];
    const food = c.food === undefined ? '' : `<div class="cf-food" title="ตัวเลขอาหาร">${c.food}</div>`;
    const head = `<div class="cf-art"${bg(artUrl('cards', c.trait))}></div><div class="cf-name">${esc(t.name)}</div>`;
    const title = esc(`${t.name}: ${t.desc}`);
    if (o.mini) return `<div class="card cf mini g-${t.group} ${cls}" ${attrs} title="${title}">${head}${food}</div>`;
    return `<div class="card cf g-${t.group} ${cls}" ${attrs} title="${title}">${head}
      <div class="cf-type">${esc(typeLine(M, t))}</div><div class="cf-text">${esc(t.short)}</div>${food}</div>`;
  }

  root.CardFace = { card, typeLine, esc };
}(typeof self !== 'undefined' ? self : this));
