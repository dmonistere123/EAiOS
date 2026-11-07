export interface InsightUse {id:string;name:string;description:string;count:number;chats:number;runs:number;lastAt:string;route:string;}
export interface InsightRecommendation {title:string;module:string;kind:'existing'|'new';evidenceIds:string[];why:string;proposal:string;firstStep:string;effort:'small'|'medium'|'large';executiveHabit?:string;successMeasure?:string;}
export interface InsightReport {id:string;generatedAt:string;days:number;snapshotId:string;model:string;recommendations:InsightRecommendation[];}
export interface InsightsSnapshot {
 days:number;from:string;generatedAt:string;snapshotId:string;
 totals:{chatRequests:number;telegramRequests:number;appRequests:number;scheduleRuns:number;failedRuns:number;tasksCreated:number;skillToolCalls:number;maintenanceRuns:number;unclassifiedRuns:number};
 topUses:InsightUse[];channels:{name:string;count:number}[];
 schedules:{id:string;name:string;enabled:boolean;lastStatus:string;lastRun:string|null}[];
 skills:{name:string;modifiedAt:string}[];
 coverage:string[];warnings:string[];reports:InsightReport[];generationAvailable:boolean;
}
