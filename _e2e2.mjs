import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import crypto from "node:crypto";
import fs from "node:fs";
const BASE = "http://localhost:3111";
const sa = JSON.parse(fs.readFileSync("./serviceAccountKey.json","utf8"));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(app), auth = getAuth(app);
let failed = 0;
const ok=(c,m)=>{console.log(`  ${c?"PASS":"FAIL"}  ${m}`); if(!c) failed++;};
const crack=h=>{for(let i=100000;i<=999999;i++) if(crypto.createHash("sha256").update(String(i)).digest("hex")===h) return String(i);};
const post=async(p,b,h={})=>{const r=await fetch(BASE+p,{method:"POST",headers:{"Content-Type":"application/json",...h},body:JSON.stringify(b)});return{status:r.status,data:await r.json().catch(()=>({}))};};
const clean=async e=>{try{const u=await auth.getUserByEmail(e);
  const m=await db.collection("teacher_student_mapping").where("studentId","==",u.uid).get();
  for(const d of m.docs) await d.ref.delete();
  await db.collection("users").doc(u.uid).delete().catch(()=>{}); await auth.deleteUser(u.uid);}catch{}
  await db.collection("pendingRegistrations").doc(e).delete().catch(()=>{});};
const stamp=Date.now();

console.log("\nT1 — the public placement list");
{
  const r = await fetch(BASE+"/api/auth/placements").then(r=>r.json());
  ok(r.success && Array.isArray(r.placements), "endpoint responds");
  const b241 = r.placements.find(p=>p.batch==="241");
  ok(!!b241, `batch 241 present (${r.placements.length} batches)`);
  ok(b241?.sections.includes("D3") && b241?.sections.includes("D1"), `241 sections: ${b241?.sections.join(",")}`);
  ok(r.placements.every(p=>p.sections.length>0), "no batch is offered without sections");
}

console.log("\nT2 — a student registering into a COVERED section is live immediately");
{
  const email=`e2e-cov-${stamp}@example.com`;
  const reg=await post("/api/auth/register",{name:"Covered Student",email,password:"test123456",role:"student",batch:"241",section:"D3",studentCode:"E2E-1"});
  ok(reg.status===200,`register 200 (${reg.data?.error||"ok"})`);
  const otp=crack((await db.collection("pendingRegistrations").doc(email).get()).data().otpHash);
  const ver=await post("/api/auth/verify-otp",{email,otp,verificationToken:reg.data.verificationToken});
  ok(ver.status===200,`verify 200 (${ver.data?.error||"ok"})`);
  const uid=ver.data.user.uid;
  const p=(await db.collection("users").doc(uid).get()).data();
  ok(p.batch==="241" && p.section==="D3", `placement stored: ${p.batch}/${p.section}`);
  ok(Array.isArray(p.sections) && p.sections[0]==="D3", `sections[] = ${JSON.stringify(p.sections)}`);
  ok(p.studentCode==="E2E-1", "student code stored");
  // The whole point: covered on first login, no admin action.
  ok((p.assignedTeacherIds||[]).length>0, `assignedTeacherIds populated on signup: ${JSON.stringify(p.assignedTeacherIds)}`);
  const maps=await db.collection("teacher_student_mapping").where("studentId","==",uid).get();
  ok(maps.size>0, `${maps.size} roster link(s) created`);
  await clean(email);
}

console.log("\nT3 — an UNCOVERED section still registers, but is reported as uncovered");
{
  const email=`e2e-unc-${stamp}@example.com`;
  const reg=await post("/api/auth/register",{name:"Uncovered Student",email,password:"test123456",role:"student",batch:"262",section:"D5"});
  ok(reg.status===200,`register 200 (${reg.data?.error||"ok"})`);
  const otp=crack((await db.collection("pendingRegistrations").doc(email).get()).data().otpHash);
  const ver=await post("/api/auth/verify-otp",{email,otp,verificationToken:reg.data.verificationToken});
  ok(ver.status===200,"verify 200 — account still created");
  const p=(await db.collection("users").doc(ver.data.user.uid).get()).data();
  ok(p.batch==="262" && p.section==="D5", "placement stored");
  ok((p.assignedTeacherIds||[]).length===0, "no teachers (correct — none assigned to 262/D5)");
  await clean(email);
}

console.log("\nT4 — invalid placements are refused server-side");
{
  const mk=(b,s)=>post("/api/auth/register",{name:"Bad Placement",email:`e2e-bad-${stamp}-${b}${s}@example.com`,password:"test123456",role:"student",batch:b,section:s});
  let r=await mk("999","D1"); ok(r.status===400 && /not a recognised batch/i.test(r.data.error||""), `unknown batch rejected: "${r.data.error}"`);
  r=await mk("241","Z9");    ok(r.status===400 && /does not exist in batch/i.test(r.data.error||""), `unknown section rejected: "${r.data.error}"`);
  r=await mk("","D1");       ok(r.status===400, "missing batch rejected");
  r=await mk("241","");      ok(r.status===400, "missing section rejected");
  // Casing is normalised, not rejected.
  const email=`e2e-case-${stamp}@example.com`;
  const reg=await post("/api/auth/register",{name:"Case Test",email,password:"test123456",role:"student",batch:"241",section:"d3"});
  ok(reg.status===200,"lowercase section accepted");
  if (reg.status===200){
    const otp=crack((await db.collection("pendingRegistrations").doc(email).get()).data().otpHash);
    const ver=await post("/api/auth/verify-otp",{email,otp,verificationToken:reg.data.verificationToken});
    const p=(await db.collection("users").doc(ver.data.user.uid).get()).data();
    ok(p.section==="D3", `stored in canonical casing: "${p.section}"`);
    await clean(email);
  }
}

console.log("\nT5 — a teacher registers without any placement");
{
  const email=`e2e-tch-${stamp}@example.com`;
  const reg=await post("/api/auth/register",{name:"Teacher Person",email,password:"test123456",role:"teacher"});
  ok(reg.status===200,`register 200 without batch/section (${reg.data?.error||"ok"})`);
  const otp=crack((await db.collection("pendingRegistrations").doc(email).get()).data().otpHash);
  const ver=await post("/api/auth/verify-otp",{email,otp,verificationToken:reg.data.verificationToken});
  ok(ver.status===200,"verify 200");
  const p=(await db.collection("users").doc(ver.data.user.uid).get()).data();
  ok(p.batch===undefined && p.section===undefined, "no placement fields on a teacher");
  ok(p.approved===false, "teacher still needs approval");
  await clean(email);
}

console.log("\nT6 — admin roster rebuild");
{
  const adminUid="BIWJoWjSWTRCYY2uK3Bn3xRPh5k1";
  const ct=await auth.createCustomToken(adminUid);
  const idToken=(await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.KEY}`,
    {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:ct,returnSecureToken:true})})).json()).idToken;
  const H={Authorization:`Bearer ${idToken}`};

  const unauth=await post("/api/admin/roster/sync",{},{});
  ok(unauth.status===401,`unauthenticated rebuild rejected (${unauth.status})`);

  const r=await post("/api/admin/roster/sync",{},H);
  ok(r.status===200 && r.data.success,`rebuild ran (${r.status})`);
  ok(r.data.studentsChecked>0, `checked ${r.data.studentsChecked} students`);
  ok(r.data.studentsCovered>0, `${r.data.studentsCovered} covered, ${r.data.uncovered} uncovered`);
  // Idempotent: a second run must change nothing.
  const r2=await post("/api/admin/roster/sync",{},H);
  ok(r2.data.linksCreated===0 && r2.data.linksRemoved===0, `second run is a no-op (+${r2.data.linksCreated}/-${r2.data.linksRemoved})`);
  ok(r2.data.studentsCovered===r.data.studentsCovered, "coverage is stable across runs");
}

console.log(failed===0 ? "\nAll passed." : `\n${failed} FAILURE(S)`);
process.exit(failed===0?0:1);
