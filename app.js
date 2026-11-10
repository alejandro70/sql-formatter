/* ============================================================
   app.js — Lógica de la interfaz (pestañas, opciones, acciones)
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

const SAMPLE_SQL = `-- Ejemplo: consulta sin formatear
select o.id, c.nombre cliente, sum(oi.cantidad * oi.precio) total, case when sum(oi.cantidad * oi.precio) > 1000 then 'VIP' when sum(oi.cantidad * oi.precio) > 500 then 'Frecuente' else 'Normal' end categoria from pedidos o inner join clientes c on c.id = o.cliente_id left join detalle_pedido oi on oi.pedido_id = o.id where o.estado in ('pagado','enviado') and o.fecha between '2024-01-01' and '2024-12-31' and o.descuento is not null group by o.id, c.nombre having sum(oi.cantidad) > 0 order by total desc;
select id, nombre, email from usuarios where id in (select usuario_id from sesiones where activa = 1) and estado = 'activo';`;

function getOptions() {
  return {
    mode: document.querySelector('input[name="mode"]:checked').value,
    indent: $('indent').value,
    keywordCase: $('kwCase').value,
    statementBreaks: Math.max(1, Math.min(5, parseInt($('stmtBreaks').value, 10) || 1)),
    expandCommaLists: $('optCommas').checked,
    trailingCommas: $('optTrailing').checked,
    spaceAfterComma: $('optSpaceComma').checked,
    expandBoolean: $('optBool').checked,
    expandCase: $('optCase').checked,
    expandBetween: $('optBetween').checked,
    expandInLists: $('optIn').checked,
    breakJoinOn: $('optJoinOn').checked,
    preserveComments: $('optComments').checked,
    coloring: $('optColor').checked
  };
}

let lastFormatted = '';
let lastHtml = '';

function run() {
  const opts = getOptions();
  const src = $('inputSql').value;
  lastFormatted = opts.mode === 'colorize' ? src : formatSql(src, opts);
  lastHtml = sqlToHtml(lastFormatted, opts.coloring);
  $('outputCode').innerHTML = lastHtml;
  $('htmlCode').textContent = lastHtml;
}

/* ------------------------------ Pestañas ------------------------------ */

function activateTab(target) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.target === target));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === target));
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.target !== 'pane-input') run();
    activateTab(btn.dataset.target);
  });
});

/* ------------------------------ Acciones ------------------------------ */

function flashButton(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1300);
}

function copyText(text, btn) {
  const done = () => flashButton(btn, '✅ ¡Copiado!');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* sin acceso al portapapeles */ }
  document.body.removeChild(ta);
  done();
}

$('btnFormat').addEventListener('click', () => { run(); activateTab('pane-output'); });
$('btnCopy').addEventListener('click', e => { run(); copyText(lastFormatted, e.currentTarget); });
$('btnCopyHtml').addEventListener('click', e => { run(); copyText(lastHtml, e.currentTarget); });
$('btnSample').addEventListener('click', () => { $('inputSql').value = SAMPLE_SQL; run(); activateTab('pane-output'); });
$('btnClear').addEventListener('click', () => { $('inputSql').value = ''; run(); activateTab('pane-input'); $('inputSql').focus(); });

/* --------------------------- Eventos en vivo --------------------------- */

let debounceTimer = null;
$('inputSql').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(run, 400);
});

$('inputSql').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    run();
    activateTab('pane-output');
  }
});

document.querySelectorAll('.options-card input, .options-card select').forEach(el => {
  el.addEventListener('change', run);
});

/* ------------------------------- Inicio ------------------------------- */

$('inputSql').value = SAMPLE_SQL;
run();
