import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { sha256Hex } from "../lib/crypto.js";
import { processRefund } from "./processRefund.js";
import { toFils } from "@filspay/money";
import { buildEnvelope } from "../webhooks/envelope.js";
import { signPayload, verifySignature } from "../webhooks/sign.js";
import { getReconciliationReport } from "../settlement/query.js";
import { applyEvent } from "../../../reporting/src/consumer/applyEvent.js";
import { withTransaction } from "../db/withTransaction.js";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:6});
const config=loadConfig({DATABASE_URL:process.env.DATABASE_URL,NODE_ENV:"test",FEATURE_REFUNDS:"true",INTERNAL_API_TOKEN:"test-internal-token",WEBHOOK_SECRET_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64"),ACQUIRER_FAILURE_RATE:"0",ACQUIRER_LATENCY_MIN_MS:"0",ACQUIRER_LATENCY_MAX_MS:"1"});
const app=buildApp(config,pool);
test.after(async()=>{await app.close();await pool.end();});
async function fixture(amount=10000,captured=amount,discount=0){
 const m=(await pool.query("INSERT INTO merchants (display_name,mdr_bps,onboarding_status,negotiated_discount_bps) VALUES ('Fork refunds',250,'approved',$1) RETURNING id",[discount])).rows[0].id as string;
 const u=(await pool.query("INSERT INTO merchant_users (merchant_id,email,password_hash,role) VALUES ($1,$2,'unused','owner') RETURNING id",[m,`${randomUUID()}@fork.test`])).rows[0].id;
 const key=randomUUID();const k=(await pool.query("INSERT INTO api_keys (merchant_id,key_hash,key_prefix,created_by) VALUES ($1,$2,'fork_test',$3) RETURNING id",[m,sha256Hex(key),u])).rows[0].id;
 const a=await app.inject({method:"POST",url:"/v1/transactions",headers:{authorization:`Bearer ${key}`,"idempotency-key":randomUUID()},payload:{amountFils:amount,card:{pan:"4242424242424242",expiryMonth:12,expiryYear:2030,cvv:"123"}}});assert.equal(a.statusCode,201,a.body);
 const id=a.json().id as string;const c=await app.inject({method:"POST",url:`/v1/transactions/${id}/capture`,headers:{authorization:`Bearer ${key}`,"idempotency-key":randomUUID()},payload:{amountFils:captured}});assert.equal(c.statusCode,200,c.body);
 return {merchantId:m,id,key,actor:{type:"merchant_api_key" as const,id:k}};
}
const approving={authorize:app.acquirer.authorize,capture:app.acquirer.capture,refund:async()=>({outcome:"approved" as const,acquirerReference:"fork-refund",latencyMs:0})};
const refund=(f:Awaited<ReturnType<typeof fixture>>,amount?:number,key=randomUUID())=>processRefund(pool,approving,{transactionId:f.id,merchantId:f.merchantId,amountFils:amount===undefined?undefined:toFils(amount),idempotencyKey:key,actor:f.actor});
test("refund ceiling is captured total, before contacting acquirer",async()=>{
 const f=await fixture(10000,4000);let contacted=0;
 const r=await processRefund(pool,{...approving,refund:async()=>{contacted++;return approving.refund();}},{transactionId:f.id,merchantId:f.merchantId,amountFils:toFils(5000),idempotencyKey:randomUUID(),actor:f.actor,reason:"regression"});
 assert.equal(r.statusCode,422);assert.equal(contacted,0);
});
test("concurrent refunds cannot exceed captured money",async()=>{
 const f=await fixture(4000);const rs=await Promise.all([refund(f,3000),refund(f,3000)]);assert.deepEqual(rs.map(r=>r.statusCode).sort(),[200,422]);
 const t=(await pool.query("SELECT refunded_fils FROM transactions WHERE id=$1",[f.id])).rows[0];assert.equal(Number(t.refunded_fils),3000);
});
test("unknown processor outcome keeps pending money unavailable to another refund",async()=>{
 const f=await fixture(4000);await assert.rejects(processRefund(pool,{...approving,refund:async()=>{throw Error("unknown processor outcome");}},{transactionId:f.id,merchantId:f.merchantId,amountFils:toFils(3000),idempotencyKey:randomUUID(),actor:f.actor}),/unknown processor outcome/);
 assert.equal((await refund(f,3000)).statusCode,422);
 const row=(await pool.query("SELECT status,amount_fils FROM refunds WHERE transaction_id=$1",[f.id])).rows[0];assert.equal(row.status,"pending");assert.equal(Number(row.amount_fils),3000);
});
test("partial refunds plus final remainder reverse discounted fee exactly and replay once",async()=>{
 const f=await fixture(10000,10000,1000);const key=randomUUID();const first=await refund(f,3333,key);assert.equal(first.statusCode,200);
 assert.deepEqual(await refund(f,3333,key),first);assert.equal((await refund(f,3333)).statusCode,200);assert.equal((await refund(f)).statusCode,200);
 const r=(await pool.query("SELECT count(*)::int n,sum(fee_reversed_fils)::int fee,bool_and(reason='unspecified') reasons FROM refunds WHERE transaction_id=$1",[f.id])).rows[0];assert.equal(r.n,3);assert.equal(r.fee,225);assert.equal(r.reasons,true);
 const t=(await pool.query("SELECT status,refunded_fils FROM transactions WHERE id=$1",[f.id])).rows[0];assert.equal(t.status,"refunded");assert.equal(Number(t.refunded_fils),10000);
 await pool.query("REFRESH MATERIALIZED VIEW refund_merchant_summary");
 const summary=(await pool.query("SELECT refund_count,original_captured_fils,total_refunded_fils FROM refund_merchant_summary WHERE merchant_id=$1",[f.merchantId])).rows[0];
 assert.equal(Number(summary.refund_count),3);assert.equal(Number(summary.original_captured_fils),10000);assert.equal(Number(summary.total_refunded_fils),10000);
});
test("both route forms enforce tenant ownership, hold, feature flag and idempotency",async()=>{
 const a=await fixture();const b=await fixture();
 const request=(path:string,key:string,txn:string,idem=randomUUID())=>app.inject({method:"POST",url:path,headers:{authorization:`Bearer ${key}`,"idempotency-key":idem},payload:{transactionId:txn,amountFils:1000}});
 assert.equal((await request("/v1/refunds",a.key,b.id)).statusCode,404);
 assert.equal((await request(`/v1/merchants/${b.merchantId}/refunds`,a.key,b.id)).statusCode,403);
 const k=randomUUID();const r=await request(`/v1/merchants/${a.merchantId}/refunds`,a.key,a.id,k);assert.equal(r.statusCode,200,r.body);assert.deepEqual((await request(`/v1/merchants/${a.merchantId}/refunds`,a.key,a.id,k)).json(),r.json());
 await pool.query("UPDATE merchants SET refunds_enabled=false WHERE id=$1",[a.merchantId]);assert.equal((await request("/v1/refunds",a.key,a.id)).statusCode,403);
 const off=buildApp({...config,featureRefunds:false},pool);try{assert.equal((await off.inject({method:"POST",url:"/v1/refunds",headers:{authorization:`Bearer ${b.key}`},payload:{transactionId:b.id}})).statusCode,501);}finally{await off.close();}
});
test("POST /v1/refunds partial then remainder reconciles ledger, events, report and webhook signature",async()=>{
 const f=await fixture(10000);
 const post=(amountFils:number|undefined,idem:string)=>app.inject({method:"POST",url:"/v1/refunds",headers:{authorization:`Bearer ${f.key}`,"idempotency-key":idem},payload:amountFils===undefined?{transactionId:f.id}:{transactionId:f.id,amountFils}});
 const k=randomUUID();const first=await post(4000,k);assert.equal(first.statusCode,200,first.body);assert.deepEqual((await post(4000,k)).json(),first.json());
 assert.equal((await post(undefined,randomUUID())).statusCode,200);
 const legs=(await pool.query("SELECT direction,amount_fils FROM ledger_entries WHERE transaction_id=$1 AND description LIKE 'refund:%'",[f.id])).rows;
 let deb=0,cred=0;for(const row of legs){const n=Number(row.amount_fils);row.direction==="debit"?deb+=n:cred+=n;}
 assert.equal(deb,cred);
 const t=(await pool.query("SELECT status,refunded_fils FROM transactions WHERE id=$1",[f.id])).rows[0];assert.equal(t.status,"refunded");assert.equal(Number(t.refunded_fils),10000);
 const ev=await app.inject({method:"GET",url:`/v1/transactions/${f.id}/events`,headers:{authorization:`Bearer ${f.key}`}});assert.equal(ev.statusCode,200,ev.body);
 const types=(ev.json() as Array<{eventType:string}>).map(e=>e.eventType);assert.ok(types.includes("refund_partial"));assert.ok(types.includes("refunded"));
 const day=(await pool.query("SELECT to_char(occurred_at AT TIME ZONE 'Asia/Bahrain','YYYY-MM-DD') AS d FROM refunds WHERE transaction_id=$1 ORDER BY occurred_at DESC LIMIT 1",[f.id])).rows[0].d as string;
 const to=(await pool.query("SELECT to_char((to_date($1,'YYYY-MM-DD')+interval '1 day')::date,'YYYY-MM-DD') AS d",[day])).rows[0].d as string;
 const report=await getReconciliationReport(pool,{merchantId:f.merchantId,from:day,to});
 assert.equal(report.gapFils,0);assert.equal(report.explained,true);
 const {ledgerMerchantPayableNetFils,settlementNetPayoutFils,pendingUnbatchedFils}=report;
 if(pendingUnbatchedFils!==0){assert.equal(pendingUnbatchedFils,ledgerMerchantPayableNetFils);assert.equal(settlementNetPayoutFils,0);}else{assert.equal(ledgerMerchantPayableNetFils,0);assert.equal(settlementNetPayoutFils,0);assert.equal(pendingUnbatchedFils,0);}
 const row=(await pool.query("SELECT * FROM outbox_events WHERE event_type='refund.succeeded' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1",[f.id])).rows[0];assert.ok(row);
 const env=buildEnvelope(randomUUID(),{eventType:row.event_type,aggregateId:row.aggregate_id,payload:row.payload,createdAt:row.created_at});
 const {signature}=signPayload(env,"whsec_fork_refund_proof");assert.deepEqual(verifySignature(env,signature,"whsec_fork_refund_proof"),{valid:true});
});
test("refund webhook payload, API refunded total and Bahrain daily reporting are connected",async()=>{
 const f=await fixture();const r=await refund(f,1000);assert.equal(r.statusCode,200);
 const row=(await pool.query("SELECT * FROM outbox_events WHERE event_type='refund.succeeded' AND aggregate_id=$1",[f.id])).rows[0];assert.ok(row);
 const id=randomUUID();const env=buildEnvelope(id,{eventType:row.event_type,aggregateId:row.aggregate_id,payload:row.payload,createdAt:row.created_at});assert.equal(env.id,id);assert.equal(env.data.amountFils,1000);assert.equal(env.data.refundId,(r.body as {id:string}).id);
 const at=new Date("2026-03-01T22:00:00Z");await withTransaction(pool,c=>applyEvent(c,{...row,created_at:at}));
 const roll=(await pool.query("SELECT refund_count,refund_gross_fils FROM merchant_daily_volume WHERE merchant_id=$1 AND volume_date='2026-03-02'",[f.merchantId])).rows[0];assert.equal(roll.refund_count,1);assert.equal(Number(roll.refund_gross_fils),1000);
 const t=await app.inject({url:`/v1/transactions/${f.id}`,headers:{authorization:`Bearer ${f.key}`}});assert.equal(t.json().refundedFils,1000);
});
