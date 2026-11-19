/* Presentation-only schedule filters; server-side authorization remains unchanged. */
(function () {
  'use strict';
  function init() {
    const tbody=document.getElementById('scheduleRows');
    const wrap=document.getElementById('managerScheduleTableWrap');
    if(!tbody||!wrap||document.getElementById('scheduleListFilters'))return;
    const host=document.createElement('section');
    host.id='scheduleListFilters'; host.className='schedule-list-filters';
    host.setAttribute('aria-label','Class schedule search and filters');
    host.innerHTML=
    '<div class="schedule-filter-grid">'+
    '<label>Search<input id="slfSearch" type="search" autocomplete="off" placeholder="Search schedules, subjects, teachers…"></label>'+
    '<label>Department<select id="slfDepartment"><option value="">All departments</option></select></label>'+
    '<label>Grade<select id="slfGrade"><option value="">All grades</option></select></label>'+
    '<label>Day<select id="slfDay"><option value="">All days</option></select></label>'+
    '<button id="slfToggle" type="button" class="outline-button" aria-expanded="false" aria-controls="slfAdvanced">More filters</button></div>'+
    '<div id="slfAdvanced" class="schedule-filter-grid advanced" hidden>'+
    '<label>Section<select id="slfSection"><option value="">All sections</option></select></label>'+
    '<label>Teacher<select id="slfTeacher"><option value="">All teachers</option></select></label>'+
    '<label>Subject<select id="slfSubject"><option value="">All subjects</option></select></label>'+
    '<label>Classroom<select id="slfClassroom"><option value="">All classrooms</option></select></label>'+
    '<label>Schedule type<select id="slfType"><option value="">All types</option><option value="advisory">Advisory / Homeroom</option><option value="other">Special class</option><option value="class">Regular class</option></select></label></div>'+
    '<div class="schedule-filter-footer"><span id="slfCount" role="status" aria-live="polite"></span><div class="schedule-filter-controls">'+
    '<label>Sort by<select id="slfSort"><option value="index">Default</option><option value="grade">Grade</option><option value="section">Section</option><option value="subject">Subject</option><option value="teacher">Teacher</option><option value="day">Day</option><option value="time">Time</option></select></label>'+
    '<label>Rows<select id="slfSize"><option>25</option><option>50</option><option>100</option></select></label>'+
    '<button type="button" id="slfClear" class="outline-button">Clear filters</button>'+
    '<button type="button" id="slfPrev" class="outline-button">Previous</button>'+
    '<span id="slfPage"></span><button type="button" id="slfNext" class="outline-button">Next</button></div></div>';
    wrap.before(host);
    const style=document.createElement('style');
    style.textContent='.schedule-list-filters{padding:12px;margin:12px 0;border:1px solid var(--border-color,#d7dfe8);border-radius:12px;background:var(--surface,#fff);color:inherit}'+
    '.schedule-filter-grid{display:grid;grid-template-columns:minmax(180px,2fr) repeat(3,minmax(100px,1fr)) auto;align-items:end;gap:8px}'+
    '.schedule-filter-grid.advanced{grid-template-columns:repeat(auto-fit,minmax(135px,1fr));margin-top:10px}'+
    '.schedule-list-filters label{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;font-weight:600}'+
    '.schedule-list-filters select,.schedule-list-filters input{width:100%;min-width:0;height:36px;border:1px solid var(--border-color,#cad5df);background:var(--input-bg,var(--surface,#fff));color:inherit;border-radius:8px;padding:5px 8px;font-size:13px}'+
    '.schedule-list-filters button{min-height:36px;padding:6px 10px;white-space:nowrap;font-size:12px}'+
    '.schedule-filter-footer,.schedule-filter-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap}'+
    '.schedule-filter-footer{justify-content:space-between;margin-top:10px}'+
    '#slfCount,#slfPage{font-size:12px;opacity:.8}'+
    '@media(max-width:900px){.schedule-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.schedule-filter-grid>label:first-child{grid-column:1/-1}.schedule-filter-grid>button{grid-column:1/-1}}'+
    '@media(max-width:520px){.schedule-filter-grid.advanced{grid-template-columns:repeat(2,minmax(0,1fr))}}';
    document.head.append(style);
    const get=id=>document.getElementById('slf'+id);
    const fields=['Department','Grade','Day','Section','Teacher','Subject','Classroom'];
    const key={Department:'department',Grade:'grade',Day:'day',Section:'section',Teacher:'teacher',Subject:'subject',Classroom:'classroom'};
    let page=1, updating=false, original=new WeakMap(), savedRows=[];
    const text=el=>(el?.textContent||'').trim().replace(/\s+/g,' ');
    function extract(row,index){
      const cell=name=>row.querySelector('[data-label="'+name+'"]');
      const cells=[...row.cells], offset=cells.length===11?1:0;
      const data={index:index,schedule:text(cell('Schedule')),subject:text(cell('Subject')),department:text(cell('Department')),
        grade:text(cell('Grade')),section:text(cell('Section')),classroom:text(cells[offset+5]),day:text(cell('Days')),
        time:text(cell('Time')),teacher:text(cell('Assigned teacher'))};
      data.type=data.schedule.includes('Advisory / Homeroom')?'advisory':data.schedule.includes('Special class')?'other':'class';
      data.search=Object.values(data).join(' ').toLocaleLowerCase();
      return {row:row,data:data};
    }
    function options(rows){
      fields.forEach(id=>{
        const select=get(id), old=select.value;
        let values=[...new Set(rows.map(item=>item.data[key[id]]).filter(s=>s&&s!=='—'))];
        if(id==='Day') values=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].filter(day=>rows.some(item=>item.data.day.toLowerCase().includes(day.toLowerCase())));
        else values.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
        while(select.options.length>1)select.remove(1);
        values.forEach(v=>select.add(new Option(v,v)));
        select.value=values.includes(old)?old:'';
      });
    }
    function apply(){
      if(updating)return;
      const rows=savedRows;
      const q=get('Search').value.trim().toLocaleLowerCase();
      const match=rows.filter(item=>{
        const d=item.data;
        return (!q||d.search.includes(q))&&fields.every(id=>{
          const v=get(id).value;
          return !v||(id==='Day'?d.day.toLowerCase().includes(v.toLowerCase()):d[key[id]]===v);
        })&&(!get('Type').value||d.type===get('Type').value);
      });
      const sort=get('Sort').value;
      match.sort((a,b)=>sort==='index'?a.data.index-b.data.index:
        a.data[sort].localeCompare(b.data[sort],undefined,{numeric:true})||a.data.index-b.data.index);
      const size=Number(get('Size').value)||25,pages=Math.max(1,Math.ceil(match.length/size));
      page=Math.max(1,Math.min(page,pages));
      const showing=new Set(match.slice((page-1)*size,page*size).map(x=>x.row));
      rows.forEach(item=>{item.row.hidden=!showing.has(item.row);item.row.style.display=showing.has(item.row)?'':'none';});
      get('Count').textContent='Showing '+(match.length?(page-1)*size+1:0)+'–'+Math.min(page*size,match.length)+' of '+match.length+' matching schedules ('+rows.length+' total)';
      get('Page').textContent='Page '+page+' / '+pages;
      get('Prev').disabled=page===1;get('Next').disabled=page===pages;
      let empty=document.getElementById('slfEmpty');
      if(!empty){empty=document.createElement('tr');empty.id='slfEmpty';empty.innerHTML='<td colspan="11" class="empty-cell">No schedules match. Clear filters to see all records.</td>';tbody.append(empty);}
      empty.hidden=match.length>0||rows.length===0;empty.style.display=empty.hidden?'none':'';
    }
    function reload(){
      if(updating)return;
      updating=true;
      try {
        const rows=[...tbody.querySelectorAll('tr')].filter(row=>row.querySelector('[data-label="Schedule"]'));
        // The schedule renderer replaces the entire tbody when data changes.
        if(rows.length!==savedRows.length||rows.some(row=>!savedRows.some(x=>x.row===row))){
          savedRows=rows.map((row,index)=>extract(row,index));
          options(savedRows);page=1;
        }
      } finally {updating=false;}
      apply();
    }
    fields.forEach(id=>get(id).addEventListener('change',()=>{page=1;apply();}));
    ['Type','Sort','Size'].forEach(id=>get(id).addEventListener('change',()=>{page=1;apply();}));
    get('Search').addEventListener('input',()=>{page=1;apply();});
    get('Clear').addEventListener('click',()=>{get('Search').value='';fields.concat(['Type','Sort','Size']).forEach(id=>get(id).selectedIndex=0);page=1;apply();});
    get('Prev').addEventListener('click',()=>{page--;apply();});
    get('Next').addEventListener('click',()=>{page++;apply();});
    get('Toggle').addEventListener('click',()=>{const open=get('Advanced').hidden;get('Advanced').hidden=!open;get('Toggle').setAttribute('aria-expanded',String(open));get('Toggle').textContent=open?'Fewer filters':'More filters';});
    const observer=new MutationObserver(changes=>{if(changes.some(c=>[...c.addedNodes,...c.removedNodes].some(node=>node.id!=='slfEmpty')))reload();});
    observer.observe(tbody,{childList:true});
    reload();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
