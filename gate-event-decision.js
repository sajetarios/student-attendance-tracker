'use strict';

/**
 * Server-only physical gate state machine, accepting ordered canonical gate
 * movements (TIME_IN/TIME_OUT). Never pass DTR or OB authorization rows.
 */
function decideNextGateEvent(events) {
  if (!Array.isArray(events)) return {status:'REVIEW',reason:'INVALID_HISTORY'};
  const history=events.map(item=>typeof item==='string'?item.toUpperCase():typeof item?.eventType==='string'?item.eventType.toUpperCase():null);
  if (history.some(item=>item!=='TIME_IN'&&item!=='TIME_OUT'))
    return {status:'REVIEW',reason:'INVALID_HISTORY'};
  for(let i=0;i<history.length;i++){
    if(history[i] !== (i%2===0?'TIME_IN':'TIME_OUT'))
      return {status:'REVIEW',reason:'AMBIGUOUS_HISTORY'};
  }
  return {status:'READY',eventType:history.length%2===0?'TIME_IN':'TIME_OUT'};
}
module.exports={decideNextGateEvent};
