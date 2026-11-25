import type {DcrFields,DcrCitation} from './dcr.ts';
export type ScanKind='received'|'sent'|'calendar'|'artifact';
export interface ScanOrigin {kind:ScanKind;accountId?:string;email?:string;externalId:string;url?:string;observedAt:string;sourceAt?:string;}
export interface ScanInput {key:string;version:string;title:string;text:string;origin:ScanOrigin;artifact?:{id:string;version:string};removed?:boolean;}
export interface ScanAccount {connectionId:string;email:string;providerUserId:string;}
export interface ScannerConfig {enabled:boolean;timezone:string;hours:number[];accounts:ScanAccount[];artifacts:boolean;lookbackDays:number;}
export interface DcrFinding {crmContactId?:string;mergedInto?:string;id:string;revision:number;fields:DcrFields;citations:DcrCitation[];explanation:string;state:'detected'|'confirmed'|'dismissed'|'revalidating';sourceIds:string[];createdAt:string;updatedAt:string;recordId?:string;targetRecordId?:string;targetRevision?:number;}
export interface ScanRun {id:string;startedAt:string;finishedAt?:string;state:'running'|'complete'|'partial'|'failed';read:number;analyzed:number;found:number;errors:string[];}
export interface ScannerStatus {relationshipEvidence?:{recordId:string;sourceIds:string[];citations:DcrCitation[]}[];configured:boolean;paused:boolean;timezone:string;hours:number[];accounts:string[];artifacts:boolean;lookbackDays:number;lastRun?:ScanRun;pending:number;findings:DcrFinding[];}
