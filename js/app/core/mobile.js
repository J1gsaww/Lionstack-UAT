"use strict";
/* js/app/core/mobile.js
   Phone-only behaviour, paired with the MOBILE block in css/styles.css:
     1. hamburger toggles the sidebar drawer (+ backdrop, Esc, tap-to-close)
     2. stamps data-label on every data-table <td> from its <thead>, so the
        card-per-row layout can render "LABEL: value" on narrow screens.
   Self-contained (IIFE) — it only touches the DOM, shares nothing. */
(function(){
  function setupDrawer(){
    var toggle   = document.getElementById('mobileNavToggle');
    var backdrop = document.getElementById('mobileNavBackdrop');
    var sidebar  = document.querySelector('.sidebar');
    if(!toggle || !sidebar) return;
    function open(){  sidebar.classList.add('open');    if(backdrop) backdrop.classList.add('show');    toggle.setAttribute('aria-expanded','true'); }
    function close(){ sidebar.classList.remove('open'); if(backdrop) backdrop.classList.remove('show'); toggle.setAttribute('aria-expanded','false'); }
    toggle.addEventListener('click', function(){ sidebar.classList.contains('open') ? close() : open(); });
    if(backdrop) backdrop.addEventListener('click', close);
    sidebar.addEventListener('click', function(e){ if(e.target.closest && e.target.closest('.nav-item')) close(); });
    window.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  }

  function labelizeTables(scope){
    var root = (scope && scope.querySelectorAll) ? scope : document;
    root.querySelectorAll('table.art-table').forEach(function(table){
      var ths = table.querySelectorAll('thead th');
      if(!ths.length) return;
      var labels = Array.prototype.map.call(ths, function(th){ return (th.textContent || '').trim(); });
      table.querySelectorAll('tbody tr').forEach(function(tr){
        Array.prototype.forEach.call(tr.children, function(cell, i){
          if(cell.tagName === 'TD') cell.setAttribute('data-label', labels[i] || '');
        });
      });
    });
  }

  function setupTableLabels(){
    var main = document.querySelector('.main') || document.body;
    labelizeTables(main);
    if(typeof MutationObserver === 'undefined') return;
    var scheduled = false;
    new MutationObserver(function(){
      if(scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function(){ scheduled = false; labelizeTables(main); });
    }).observe(main, { childList:true, subtree:true });
  }

  function init(){ setupDrawer(); setupTableLabels(); }
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
