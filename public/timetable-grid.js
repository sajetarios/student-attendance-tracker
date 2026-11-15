'use strict';
/* Compact, accessible week grid and non-modal class details. */
(function () {
  const daysOfWeek=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const palettes=['violet','blue','mint','amber','pink','indigo'];
  let current=null,tooltip=null,pinned=false,hoverTimer=null,closeTimer=null,lastTrigger=null,gridController=null;
  function escape(value) {
    return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function hash(value) {
    let n=0; for(const char of String(value||'')) n=(n*31+char.charCodeAt(0))|0;
    return Math.abs(n)%palettes.length;
  }
  function clock(value) {return String(value||'—').slice(0,5);}
  function label(entry) {return entry.subjectName||entry.periodName||'Class';}
  function asLongDate(value) {
    const time=new Date(value+'T12:00:00Z');
    return Number.isNaN(time.getTime())?value:time.toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  }
  function close(returnFocus) {
    clearTimeout(hoverTimer);clearTimeout(closeTimer);
    if(!tooltip||tooltip.hidden)return;
    tooltip.hidden=true;
    tooltip.setAttribute('aria-hidden','true');
    if(lastTrigger)lastTrigger.setAttribute('aria-expanded','false');
    if(returnFocus && lastTrigger && document.contains(lastTrigger))lastTrigger.focus({preventScroll:true});
    lastTrigger=null;current=null;pinned=false;
  }
  function ensurePanel() {
    if(tooltip)return tooltip;
    tooltip=document.createElement('div');
    tooltip.id='timetableClassDetails';
    tooltip.className='tt-detail-popover';
    tooltip.hidden=true;
    tooltip.setAttribute('role','dialog');
    tooltip.setAttribute('aria-modal','false');
    tooltip.setAttribute('aria-hidden','true');
    tooltip.setAttribute('aria-labelledby','ttDetailTitle');
    tooltip.innerHTML='<div class="tt-detail-inner"></div>';
    document.body.appendChild(tooltip);
    tooltip.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
    tooltip.addEventListener('pointerleave',()=>{if(!pinned)closeTimer=setTimeout(()=>close(false),180);});
    tooltip.addEventListener('click',event=>{
      if(event.target.closest('[data-tt-close]')) {close(true);return;}
      const action=event.target.closest('[data-tt-adjust]');
      if(action && current && current.config.onAdjust){
        const entry=current.entry, callback=current.config.onAdjust;
        close(false); callback(entry.periodId,entry.date);
      }
      const assign=event.target.closest('[data-tt-assign]');
      if(assign && current && current.config.onAssign){
        const teacher=tooltip.querySelector('[data-tt-teacher]')?.value;
        if(!teacher){tooltip.querySelector('[data-tt-error]').textContent='Choose a teacher first.';return;}
        const config=current.config,periodId=current.entry.periodId;
        assign.disabled=true;
        Promise.resolve(config.onAssign(periodId,teacher)).then(()=>{
          close(false);
        }).catch(error=>{
          assign.disabled=false;
          if(tooltip && !tooltip.hidden)tooltip.querySelector('[data-tt-error]').textContent=error?.message||'Could not assign this class.';
        });
      }
    });
    document.addEventListener('pointerdown',e=>{
      if(!tooltip||tooltip.hidden)return;
      if(tooltip.contains(e.target)||e.target.closest('[data-tt-class]'))return;
      close(false);
    },true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && tooltip && !tooltip.hidden){e.preventDefault();close(true);}});
    window.addEventListener('resize',()=>close(false));
    window.addEventListener('scroll',()=>close(false),true);
    return tooltip;
  }
  function place(anchor) {
    const panel=ensurePanel();
    panel.style.visibility='hidden';panel.hidden=false;
    const rect=anchor.getBoundingClientRect();
    const width=Math.min(340,window.innerWidth-22);
    panel.style.width=width+'px';
    const bounds=panel.getBoundingClientRect();
    const x=Math.max(11,Math.min(window.innerWidth-width-11,rect.right+12+width<window.innerWidth?rect.right+10:rect.left-width-10));
    const y=Math.max(12,Math.min(window.innerHeight-bounds.height-12,rect.top-6));
    panel.style.left=x+'px';panel.style.top=y+'px';
    panel.style.visibility='';
  }
  function open(button,config,persist) {
    const index=Number(button.dataset.ttClass);
    const entry=config.entries[index];
    if(!entry)return;
    if(pinned && lastTrigger===button && persist){close(false);return;}
    clearTimeout(closeTimer);clearTimeout(hoverTimer);
    if(lastTrigger && lastTrigger!==button)lastTrigger.setAttribute('aria-expanded','false');
    pinned=!!persist;lastTrigger=button;current={entry,config};
    button.setAttribute('aria-expanded','true');
    const tag=entry.cancelled?'Cancelled':entry.adjustment?(entry.adjustment.type==='SUBSTITUTE'?'Teacher cover':entry.adjustment.type==='REPLACE'?'Subject replacement':'Temporary change'):'Regular class';
    const items=[
      ['Teacher',entry.cancelled?'No class today':entry.assignedTeacherName||'Not assigned'],
      ['Class',String(entry.gradeLevel||'—')+' · '+String(entry.section||'All sections')],
      ['Time',clock(entry.startTime)+'–'+clock(entry.endTime)],
      ['Room',entry.classroom||'Not set'],
      ['Schedule block',entry.periodName||'Not specified'],
      ['Date',asLongDate(entry.date)]
    ];
    const rows=items.map(item=>'<div class="tt-detail-row"><dt>'+escape(item[0])+'</dt><dd>'+escape(item[1])+'</dd></div>').join('');
    const extra=entry.adjustment ? '<div class="tt-detail-change"><strong>'+escape(tag)+'</strong><span>'+
      escape((entry.adjustment.reason||'').replaceAll('_',' '))+
      (entry.adjustment.notes?' · '+entry.adjustment.notes:'')+'</span></div>' : '';
    const management=entry.canEdit && entry.date>=config.today
      ? '<button type="button" class="tt-detail-action" data-tt-adjust>Change this date</button>' : '';
    const assignChoices=!entry.assignedTeacherName && !entry.cancelled && entry.canEdit && entry.eligibleTeachers?.length
      ? '<div class="tt-quick-assign"><label for="ttQuickTeacher">Assign teacher</label><select id="ttQuickTeacher" data-tt-teacher><option value="">Choose Subject Teacher</option>'+
      entry.eligibleTeachers.map(t=>'<option value="'+escape(t.userId)+'">'+escape(t.displayName)+'</option>').join('')+
      '</select><button type="button" data-tt-assign class="tt-detail-action">Assign</button></div>' : '';
    ensurePanel().querySelector('.tt-detail-inner').innerHTML=
      '<header class="tt-detail-header"><span class="tt-detail-title-icon">▦</span><div><h3 id="ttDetailTitle">'+escape(label(entry))+
      '</h3><span class="tt-detail-kind">'+escape(tag)+'</span></div><button type="button" data-tt-close class="tt-detail-close" aria-label="Close class details">×</button></header>'+
      '<dl class="tt-detail-list">'+rows+'</dl>'+extra+assignChoices+
      '<div class="tt-detail-footer"><span class="tt-detail-tip">Saved timetable details</span>'+management+'</div>'+
      '<p data-tt-error class="tt-detail-error" role="status"></p>';
    tooltip.setAttribute('aria-hidden','false');place(button);
  }
  function render(config) {
    const host=config.host;
    if(!host)return;
    close(false);
    if(gridController)gridController.abort();
    gridController=new AbortController();
    const entries=config.entries||[],days=config.days||[],weekdayDates=config.weekdayDates||{};
    const keys=[...new Set(entries.map(e=>clock(e.startTime)+'|'+clock(e.endTime)))].sort((a,b)=>{
      const [s1,e1]=a.split('|'),[s2,e2]=b.split('|');
      return s1.localeCompare(s2)||e1.localeCompare(e2);
    });
    if(!keys.length) {
      host.innerHTML='<div class="tt-empty"><strong>No classes for the selected week.</strong><span>Try another section or choose a different week.</span></div>';
      return;
    }
    const indexed=new Map();entries.forEach((e,i)=>{
      const id=e.dayIndex+'|'+clock(e.startTime)+'|'+clock(e.endTime);
      if(!indexed.has(id))indexed.set(id,[]);
      indexed.get(id).push({...e,index:i});
    });
    const heading=days.map(day=>'<th scope="col"><span>'+escape(daysOfWeek[day].slice(0,3))+'</span><small>'+escape((weekdayDates[day]||'').slice(5))+'</small></th>').join('');
    const rows=keys.map(key=>{
      const [start,end]=key.split('|');
      return '<tr><th scope="row" class="tt-time"><strong>'+escape(start)+'</strong><span>'+escape(end)+'</span></th>'+days.map(day=>{
        const matches=indexed.get(day+'|'+key)||[];
        return '<td class="tt-class-cell">'+(matches.length?matches.map(e=>{
          const kind=e.cancelled?'cancelled':e.adjustment?'adjusted':palettes[hash(e.subjectName||e.periodName)];
          const subject=label(e);
          return '<button type="button" class="tt-subject tt-tone-'+kind+'" data-tt-class="'+e.index+
            '" aria-haspopup="dialog" aria-expanded="false" aria-label="'+escape(subject+' · '+e.gradeLevel+' '+e.section+
            ' · '+clock(e.startTime)+' to '+clock(e.endTime)+' · '+(e.assignedTeacherName||'Unassigned'))+'">'+
            escape(subject)+(e.adjustment?'<span class="tt-change-dot" aria-hidden="true">•</span>':'')+'</button>';
        }).join(''):'<span class="tt-no-class" aria-label="No class">—</span>')+'</td>';
      }).join('')+'</tr>';
    }).join('');
    host.classList.add('tt-grid-host');
    host.innerHTML='<div class="tt-grid-scroll"><table class="tt-grid" aria-label="Weekly class timetable"><thead><tr><th scope="col" class="tt-time-heading">Time</th>'+heading+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="tt-grid-legend"><span><i class="tt-legend-class"></i>Regular class</span><span><i class="tt-legend-adjusted"></i>Temporary change</span><span><i class="tt-legend-cancelled"></i>Cancelled</span>'+
      '<span class="tt-grid-hint">Tap or click a subject to see details</span></div>';
    // Bind once per render; clearing the board also clears previous handlers.
    host.addEventListener('click',e=>{
      const button=e.target.closest('[data-tt-class]');
      if(button&&host.contains(button))open(button,config,true);
    },{signal:gridController.signal});
    host.addEventListener('pointerover',e=>{
      if(!window.matchMedia('(hover:hover) and (pointer:fine)').matches)return;
      const button=e.target.closest('[data-tt-class]');
      if(!button||!host.contains(button)||pinned)return;
      clearTimeout(hoverTimer);clearTimeout(closeTimer);
      hoverTimer=setTimeout(()=>open(button,config,false),320);
    },{signal:gridController.signal});
    host.addEventListener('pointerout',e=>{
      if(!e.target.closest('[data-tt-class]')||pinned)return;
      clearTimeout(hoverTimer);
      closeTimer=setTimeout(()=>close(false),220);
    },{signal:gridController.signal});
    host.addEventListener('focusin',e=>{
      const button=e.target.closest('[data-tt-class]');
      if(button && !pinned)open(button,config,false);
    },{signal:gridController.signal});
  }
  window.TimetableGrid={render,close};
})();
