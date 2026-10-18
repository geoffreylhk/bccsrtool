const assert=require('node:assert/strict');
const fs=require('node:fs');
const {test}=require('node:test');

test('account settings SQL restricts defaults and deletes only the authenticated matching account atomically',
 {skip:!process.env.BCCSR_PGLITE_PATH},async()=>{
  const {PGlite}=require(process.env.BCCSR_PGLITE_PATH),db=new PGlite();
  const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  const aliceSession='aaaaaaaa-1111-4111-8111-111111111111',bobSession='bbbbbbbb-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,display_name text,created_at timestamptz default now());
      alter table public.profiles enable row level security;
      grant usage on schema auth,public to authenticated,anon;
      grant select,update on public.profiles to authenticated;
      create policy own_profile on public.profiles to authenticated using(auth.uid()=id) with check(auth.uid()=id);`);
    await db.exec(fs.readFileSync(require.resolve('../supabase/saved-assessments.sql'),'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../supabase/account-settings.sql'),'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../supabase/account-deletion-email.sql'),'utf8'));
    await db.query('insert into auth.users values ($1,$2),($3,$4)',[alice,'alice@example.com',bob,'bob@example.com']);
    await db.query('insert into auth.sessions values ($1,$2),($3,$4)',[aliceSession,alice,bobSession,bob]);
    await db.query('insert into public.profiles(id,display_name) values ($1,$2),($3,$4)',[alice,'Alice Smith',bob,'Bob']);
    const payload=JSON.stringify({version:5,activeProfileId:'assessment',profiles:{assessment:{selectedContaminants:[],apecs:[]}}});
    await db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3),($4,$5,$3)',[alice,'Alice assessment',payload,bob,'Bob assessment']);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.delete_own_account($1)',['alice@example.com']),{code:'42501'});
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[alice,JSON.stringify({session_id:aliceSession})]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('update public.profiles set chemical_sort=$1 where id=$2',['invalid',alice]),{code:'23514'});
    await db.query('update public.profiles set chemical_sort=$1 where id=$2',['alpha',alice]);
    assert.equal((await db.query('update public.profiles set chemical_sort=$1 where id=$2 returning id',['alpha',bob])).rows.length,0);
    for(const name of ['Alice Smith','Bob','alice','Alice@example.com','alice@example.com ']) await assert.rejects(db.query('select public.delete_own_account($1)',[name]),{code:'22023'});
    await db.exec('reset role');
    assert.equal((await db.query('select * from auth.users')).rows.length,2);
    assert.equal((await db.query('select * from auth.sessions')).rows.length,2);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:bobSession})]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.delete_own_account($1)',['alice@example.com']),{code:'42501'});
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:aliceSession})]);
    await db.exec('create table public.deletion_blocker(owner uuid references auth.users(id));');
    await db.query('insert into public.deletion_blocker values ($1)',[alice]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.delete_own_account($1)',['alice@example.com']),{code:'23503'});
    await db.exec('reset role');
    assert.equal((await db.query('select * from auth.sessions')).rows.length,2);
    assert.equal((await db.query('select * from auth.users')).rows.length,2);
    await db.exec('drop table public.deletion_blocker;set role authenticated');
    await db.query('select public.delete_own_account($1)',['alice@example.com']);
    await assert.rejects(db.query('select public.delete_own_account($1)',['alice@example.com']),{code:'42501'});
    await db.exec('reset role');
    for(const table of ['auth.users','auth.sessions','public.profiles','public.saved_assessments']){
      const rows=(await db.query('select * from '+table)).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].user_id||rows[0].id,bob);
    }
    await db.query('update public.profiles set display_name=$1 where id=$2',['',bob]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[bob,JSON.stringify({session_id:bobSession})]);
    await db.exec('set role authenticated');await db.query('select public.delete_own_account($1)',['bob@example.com']);
    await db.exec('reset role');assert.equal((await db.query('select * from auth.users')).rows.length,0);
  }finally{await db.close();}
});
