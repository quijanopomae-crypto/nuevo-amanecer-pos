/* Mobile presentation only: reuse the existing controls and business handlers. */
(function(){
  'use strict';
  const page=document.getElementById('pageInventario');if(!page)return;
  const media=matchMedia('(max-width:767px)'),moves=[];
  function relocate(node,target){if(!node)return;const marker=document.createComment('inventory original position');node.before(marker);moves.push([node,marker]);target.append(node);}
  function panel(label,kind){const details=document.createElement('details');details.className='inv-mobile-panel '+kind;const summary=document.createElement('summary');summary.textContent=label;details.append(summary);return details;}
  function decorate(){
    if(!media.matches)return;
    page.querySelectorAll('#invBody tr').forEach(row=>{
      if(row.dataset.mobileInventory||row.children.length!==6)return;
      row.dataset.mobileInventory='1';
      const cells=row.children,actions=cells[5].querySelector('.act-btns');if(!actions)return;
      const menu=panel('⋮','inv-product-menu');menu.querySelector('summary').setAttribute('aria-label','Acciones y detalles de '+(row.querySelector('.prod-name-sm')?.textContent||'producto'));
      const content=document.createElement('div');content.className='inv-menu-content';
      [row.querySelector('.prod-sku-sm'),cells[1].firstElementChild,cells[2].children[1],cells[3].firstElementChild].filter(Boolean).forEach(node=>{const line=document.createElement('div');line.textContent=node.textContent;content.append(line);});
      for(const button of actions.querySelectorAll('button')){button.dataset.inventoryOriginalText=button.textContent;button.textContent=button.classList.contains('btn-ent')?'Entrada de stock':button.classList.contains('btn-sal')?'Salida de stock':button.classList.contains('btn-edt')?'Editar producto':'Sin control de stock';}
      actions.before(menu);content.append(actions);menu.append(content);
      const name=row.querySelector('.prod-name-sm');if(name){const category=document.createElement('div');category.className='inv-mobile-category';category.textContent=cells[1].textContent.trim();name.after(category);const stock=cells[4].querySelector('.stock-pill');if(stock)name.parentElement.append(stock);name.tabIndex=0;name.setAttribute('role','button');name.setAttribute('aria-label','Ver detalles de '+name.textContent);name.onclick=event=>{event.stopPropagation();menu.open=!menu.open;};name.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();menu.open=!menu.open;}};}
    });
    const totals=page.querySelectorAll('.inv-mobile-totals strong');if(totals.length){totals[0].textContent=document.getElementById('invS3').textContent;totals[1].textContent=document.getElementById('invS4').textContent;}
    const count=page.querySelector('.inv-mobile-count');if(count){const total=document.getElementById('invB0')?.textContent||'0';count.textContent=total+(total==='1'?' producto':' productos');}
  }
  function enable(){
    if(page.classList.contains('inv-mobile-simple'))return;
    page.classList.add('inv-mobile-simple');
    const top=page.querySelector('.top-mod-bar'),chrome=page.querySelector('.page-chrome'),bar=page.querySelector('.filter-bar');
    const buttons=page.querySelector('.ocr-purchase-actions');
    const add=buttons.querySelector('button:last-child');add.classList.add('inv-mobile-add');
    const controls=document.createElement('div');controls.className='inv-mobile-controls';bar.after(controls);
    const stats=panel('Resumen ▾','inv-summary');controls.append(stats);relocate(page.querySelector('.stats-strip'),stats);
    const filters=panel('Filtrar','inv-filters');const filterContent=document.createElement('div');filterContent.className='inv-menu-content';filters.append(filterContent);bar.append(filters);relocate(document.getElementById('invCat'),filterContent);
    const tabs=page.querySelector('.tabs-wrap');relocate(tabs,chrome);const more=panel('Más ▾','inv-more');const moreContent=document.createElement('div');moreContent.className='inv-menu-content';more.append(moreContent);tabs.append(more);
    Array.from(tabs.querySelectorAll('.tab')).slice(3).forEach(tab=>relocate(tab,moreContent));
    const totals=document.createElement('div');totals.className='inv-mobile-totals';totals.innerHTML='<span>Costo <strong></strong></span><span>Venta <strong></strong></span>';chrome.append(totals);
    const count=document.createElement('div');count.className='inv-mobile-count';chrome.append(count);decorate();
  }
  function disable(){
    page.classList.remove('inv-mobile-simple');
    page.querySelectorAll('.inv-product-menu').forEach(menu=>{const actions=menu.querySelector('.act-btns');menu.before(actions);menu.remove();});
    page.querySelectorAll('[data-inventory-original-text]').forEach(button=>{button.textContent=button.dataset.inventoryOriginalText;delete button.dataset.inventoryOriginalText;button.classList.remove('inv-mobile-add');});
    page.querySelectorAll('#invBody tr').forEach(row=>{delete row.dataset.mobileInventory;const name=row.querySelector('.prod-name-sm');if(name){const stock=name.parentElement.querySelector('.stock-pill');if(stock)row.children[4].append(stock);name.removeAttribute('tabindex');name.removeAttribute('role');name.removeAttribute('aria-label');name.onclick=null;name.onkeydown=null;}});
    while(moves.length){const [node,marker]=moves.pop();marker.replaceWith(node);}
    page.querySelectorAll('.inv-tools,.inv-filters,.inv-mobile-count,.inv-more,.inv-mobile-controls,.inv-mobile-totals,.inv-mobile-category').forEach(node=>node.remove());
  }
  function sync(){if(media.matches)enable();else disable();}
  page.addEventListener('toggle',event=>{if(!event.target.open||!event.target.matches('.inv-mobile-panel'))return;page.querySelectorAll('.inv-summary[open],.inv-more[open],.inv-filters[open],.inv-product-menu[open]').forEach(other=>{if(other!==event.target&&!other.contains(event.target))other.open=false;});},true);
  page.addEventListener('click',event=>{if(event.target.closest('.tab,.btn-act,.inv-tools button'))page.querySelectorAll('.inv-more,.inv-filters,.inv-product-menu').forEach(menu=>menu.open=false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')page.querySelectorAll('details[open]').forEach(menu=>menu.open=false);});
  document.addEventListener('click',event=>{page.querySelectorAll('.inv-summary[open],.inv-more[open],.inv-filters[open],.inv-product-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  new MutationObserver(decorate).observe(document.getElementById('invBody'),{childList:true});
  new MutationObserver(()=>{const count=page.querySelector('.inv-mobile-count');if(count)count.textContent=document.getElementById('invB0').textContent+' productos';}).observe(document.getElementById('invB0'),{childList:true});
  new MutationObserver(decorate).observe(document.getElementById('invS3'),{childList:true});
  new MutationObserver(decorate).observe(document.getElementById('invS4'),{childList:true});
  new MutationObserver(()=>document.body.classList.toggle('na-inventory-active',page.classList.contains('active'))).observe(page,{attributes:true,attributeFilter:['class']});
  media.addEventListener('change',sync);sync();
})();
