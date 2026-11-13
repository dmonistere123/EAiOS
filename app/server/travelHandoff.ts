import { issueAssistantAccess } from './humanCompletion.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs';
import { getTrip, TravelApiError } from './travel.ts';
import { humanStore, prepareHumanDraft, listHumanDelegations, listHumanContacts } from './humanDelegation.ts';
import type { KeyContext } from './apiKeys.ts';
import type { MailboxIdentity } from '../src/domain/mailRouting.ts';
import type { TravelTrip, TravelBooking } from '../src/domain/types.ts';
import type { HumanChecklistItem } from '../src/domain/humanDelegation.ts';
export function bookingTitle(b:TravelBooking):string {
  return b.title || (b.kind==='flight'?`${b.airline} ${b.flightNumber} · ${b.origin} → ${b.destination}`:b.kind==='hotel'?b.hotelName:b.kind==='car'?`${b.company} ${b.carType}`:b.restaurantName);
}
export function itineraryText(t:TravelTrip,instructions:string):string {
  return [`ITINERARY — BOOKING REQUEST (NOT A RESERVATION)`,t.name,`${t.destination} · ${t.startsAt} to ${t.endsAt}`,
    `Reason for travel: ${t.purpose||'Not specified'}`,`Arrival airport: ${t.destinationPlace?.name||'Not specified'}`,`Stay location: ${t.destination}`,`Dining location: ${t.diningLocation||t.destination}`,`Trip brief: ${t.tripNotes||'Not specified'}`,`Airline requirement: ${t.airlinePolicy==='only'?'Only the stated airlines':'Preference; alternatives allowed'}`,`Planning conversation\n${(t.conversation??[]).map(m=>`${m.role==='user'?'Executive':'Ally'}: ${m.text}`).join('\n')}`,
    `Prepared: ${new Date().toISOString()}`,`Budget: ${t.budgetUsd===undefined?'Not specified':'USD '+t.budgetUsd}`,
    `Preferences: airlines ${t.preferredAirlines||'any'}; hotels ${t.preferredHotels||'any'}; dining ${t.diningPreferences||'not specified'}`,
    `Rental car requested: ${t.needsCar?'yes':'no'}`,
    ...t.bookings.filter(b=>b.status!=='cancelled').map(b=>[
      `${b.kind.toUpperCase()}: ${bookingTitle(b)}`,b.testMode?'TEST SEARCH RESULT — not live availability':'Selected option; assistant must recheck availability and price.',
      b.kind==='flight'?`${b.departureAt} → ${b.arrivalAt} (airport-local times)`:b.kind==='hotel'?`${b.checkIn} → ${b.checkOut}\n${b.address??''}`:b.kind==='car'?`${b.pickupAt} → ${b.dropoffAt}\n${b.pickupLocation}`:`${b.reservationAt}; party of ${b.partySize}\n${b.address??''}`,
      `Estimated price: ${b.currency??'USD'} ${b.amount??b.costUsd??'not provided'}`,b.details||'',b.notes||'',b.externalUrl?`Source: ${b.externalUrl}`:'',
      b.confirmationNumber?`Existing confirmation: ${b.confirmationNumber} — do not book twice`:'',
    ].filter(Boolean).join('\n')),
    `BOOKING INSTRUCTIONS\n${instructions||'Book the selected options. Ask the executive before making substitutions or exceeding the budget.'}`,
    'Record confirmation references, final costs and outcome notes in your checklist. Submit for executive sign-off when every item is complete. No booking is made by 2EP.',
  ].join('\n\n');
}
export function tripChecklist(t:TravelTrip):HumanChecklistItem[] {
  const selected=t.bookings.filter(b=>b.status!=='cancelled');
  const items=selected.map(b=>({id:b.id,title:`${b.kind}: ${bookingTitle(b)}`,done:false}));
  if(t.needsCar&&!selected.some(b=>b.kind==='car'))items.push({id:'rental-car-request',title:'Arrange rental car — confirm choice with executive',done:false});
  return items;
}
/** Saves a stable itinerary snapshot and an unassigned task; never sends or purchases. */
export async function prepareTravelHandoff(ctx:KeyContext,tripId:string,input:Record<string,unknown>,identity:MailboxIdentity) {
  const trip=await getTrip(tripId,ctx.dataRoot??ctx.eaiosRoot);
  if(!trip)throw new TravelApiError(404,'Trip not found.');
  if(trip.planningQuestion)throw new TravelApiError(409,'Resolve Ally’s trip question before handing off: '+trip.planningQuestion);
  if(typeof input.contactId!=='string'||typeof input.instructions!=='string'||input.instructions.length>8000)throw new TravelApiError(400,'Choose an assistant and valid instructions.');
  if(!trip.bookings.some(b=>b.status!=='cancelled'))throw new TravelApiError(400,'Select at least one itinerary item first.');
  if(trip.bookings.some(b=>['submitting','unknown'].includes(b.status)))throw new TravelApiError(409,'Resolve the existing provider booking outcome before delegating this trip.');
  const existing=listHumanDelegations(ctx.hermesHome).find(d=>d.tripId===tripId&&!['cancelled','rejected','declined','send_failed'].includes(d.status));
  if(existing)return {delegation:existing,existing:true};
  if(!listHumanContacts(ctx.hermesHome).some(c=>c.id===input.contactId&&c.active))throw new TravelApiError(400,'Choose an active human assistant.');
  const fingerprint=createHash('sha256').update(JSON.stringify([trip,input.contactId,input.instructions])).digest('hex');
  const taskId='t_'+fingerprint.slice(0,24),folder=join(ctx.hermesHome,'kanban','attachments');
  mkdirSync(folder,{recursive:true,mode:0o700});if(lstatSync(folder).isSymbolicLink())throw new TravelApiError(409,'Unsafe artifact storage.');
  const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));
  let artifactId:string;
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const already=db.prepare('SELECT id FROM task_attachments WHERE task_id=?').get(taskId);
    if(already)artifactId='att-'+already.id;
    else {
      const text=itineraryText(trip,input.instructions),file=join(folder,randomUUID()+'.txt');
      writeFileSync(file,text,{mode:0o600,flag:'wx'});
      try {
        db.prepare("INSERT INTO tasks(id,title,body,status,created_at) VALUES(?,?,?,'blocked',?)").run(taskId,'Book travel: '+trip.name,'Human booking request. Selected itinerary saved as an attachment. No AI execution.',Date.now()/1000);
        const result=db.prepare('INSERT INTO task_attachments(task_id,filename,stored_path,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?)').run(taskId,'itinerary-'+trip.startsAt.slice(0,10)+'.txt',file,'text/plain',Buffer.byteLength(text),'executive',Date.now()/1000);
        artifactId='att-'+result.lastInsertRowid;
      } catch(e){unlinkSync(file);throw e;}
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
  const d=prepareHumanDraft(ctx.hermesHome,{workItemId:taskId,contactId:input.contactId,instructions:input.instructions},identity,{tripId:trip.id,checklist:tripChecklist(trip)});
  const origin=process.env.EAIOS_ASSISTANT_ORIGIN;
  const access=origin?issueAssistantAccess(ctx.hermesHome,d.id):undefined;
  const delegation=humanStore(ctx.hermesHome,db=>{
    if(access&&d.package)d.package.body+='\n\nYour private booking checklist (valid for seven days):\n'+origin+'/assistant-task#'+access.token+'\nThis link grants access only to this assignment. Do not forward it.';
    db.prepare('UPDATE human_delegations SET body=? WHERE id=?').run(JSON.stringify(d),d.id);return d;
  });
  return {delegation,artifactId,existing:false};
}
