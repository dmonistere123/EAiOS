// @vitest-environment node
import { expect,it } from 'vitest';
import { csvContacts,parseCsv } from '../../server/ermImport.ts';
import { outlookContact,contactsEndpoint } from '../../server/ermProvider.ts';
it('reads BOM, escaped commas/quotes and multiline fields without treating cells as commands',()=>{
 const text='\ufeffFull Name,Company,Email,Street Address\r\n"Alex ""Ace"" Example","Example, Inc",alex@example.com,"Line 1\nLine 2"\r\n';
 expect(parseCsv(text).rows).toHaveLength(1);const [p]=csvContacts(text).items;
 expect(p.contact?.name).toBe('Alex "Ace" Example');expect(p.contact?.company).toBe('Example, Inc');expect(p.contact?.addresses[0].street).toBe('Line 1\nLine 2');
 expect(()=>parseCsv('name,email\n"unfinished,x')).toThrow();
 expect(csvContacts('name,email\nCustomer,invalid').items[0].error).toContain('email');
});
it('requires unambiguous mappings and preserves distinct namesakes',()=>{
 expect(()=>parseCsv('Name,Name\nA,B')).toThrow('Duplicate');
 const raw='Client,Address\nAlex,one@example.com\nAlex,two@example.com';
 const preview=csvContacts(raw,{name:'Client',email:'Address'});expect(preview.items).toHaveLength(2);expect(preview.items[0].id).not.toBe(preview.items[1].id);
 expect(()=>csvContacts('Random,Stuff\na,b')).toThrow('name');
});
it('maps Outlook contact information without importing personal notes and confines pagination',()=>{
 const p=outlookContact({displayName:'Alex',emailAddresses:[{address:'a@example.com'}],businessPhones:['555-0100'],mobilePhone:'555-0101',businessAddress:{street:'Example St',city:'Town'},personalNotes:'not selected'});
 expect(p.phones).toHaveLength(2);expect(p.addresses[0].city).toBe('Town');expect(JSON.stringify(p)).not.toContain('not selected');
 expect(()=>contactsEndpoint(Buffer.from('https://attacker.example/me/contacts').toString('base64url'))).toThrow();
 expect(()=>contactsEndpoint(Buffer.from('https://graph.microsoft.com/v1.0/me/messages').toString('base64url'))).toThrow();
});
