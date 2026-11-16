const option = (name, padding, role, width, second = false) => `
  <button role="${role}" style="display:flex;align-items:center;gap:12px;width:${width};padding:${padding};border:0;${second ? 'border-top:1px solid #ccc;' : ''}background:${second ? 'white' : '#eee'};font:inherit;text-align:left">
    <span style="display:flex;flex:1;min-width:0;flex-direction:column;gap:2px">
      <strong>${name}</strong><span style="font-size:12px">15% discount · 20 left</span>
    </span><strong style="flex:none">−MX$18.69</strong>
  </button>`;
const list = (first = '12px', second = '12px', role = 'option', width = '100%', parent = 'listbox') => `
  <div role="${parent}" style="width:320px;border:1px solid #ccc;border-radius:12px;overflow:auto">
    ${option('WELCOME', first, role, width)}${option('VIP-U15', second, role, width, true)}
  </div>`;
const fixture = (name, html, expected = true, kind = 'content-touches-edge') => ({ name, html, expected, kind });
const edges = [
  ['left', '12px 12px 12px 2px'], ['right', '12px 2px 12px 12px'],
  ['top', '2px 12px 12px'], ['bottom', '12px 12px 2px'],
];
export const LISTBOX_FIXTURES = [
  fixture('highlighted full-width listbox options', list(), false),
  fixture('adjacent options belong to one listbox', list(), false, 'controls-touching'),
  ...edges.flatMap(([side, padding]) => [
    fixture(`first option text too close on ${side}`, list(padding)),
    fixture(`bordered second option text too close on ${side}`, list('12px', padding)),
  ]),
  fixture('ordinary button still minds listbox edge', list('12px', '12px', 'button')),
  fixture('ordinary adjacent buttons still need separation', list('12px', '12px', 'button'), true, 'controls-touching'),
  fixture('option outside a listbox still minds edge', list('12px', '12px', 'option', '100%', 'group')),
  fixture('partial-width option still minds edge', list('12px', '12px', 'option', '80%')),
];
