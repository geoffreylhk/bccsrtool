const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

// Use a temporary PostgreSQL runtime; no production database or credentials.
test('saved assessment SQL enforces owner isolation, grants, revisions and cascade deletion',
  { skip: !process.env.BCCSR_PGLITE_PATH }, async () => {
  const { PGlite } = require(process.env.BCCSR_PGLITE_PATH);
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public, auth to anon, authenticated;
      insert into auth.users values ('${alice}'),('${bob}');`);
    await db.exec(fs.readFileSync(require.resolve('../supabase/saved-assessments.sql'), 'utf8'));
    const payload = JSON.stringify({version:5,activeProfileId:'assessment',profiles:{assessment:{selectedContaminants:[],apecs:[]}}});
    const asUser = async user => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.saved_assessments'), {code:'42501'});
    await assert.rejects(db.query("update public.saved_assessments set title='Anonymous'"), {code:'42501'});
    await assert.rejects(db.query('delete from public.saved_assessments'), {code:'42501'});
    await assert.rejects(db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3)', [alice,'Anonymous',payload]), {code:'42501'});
    await asUser(alice);
    const inserted = await db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3) returning *', [alice,'Assessment',payload]);
    const id = inserted.rows[0].id;
    assert.equal(inserted.rows[0].revision, 1);
    const updated = await db.query('update public.saved_assessments set title=$1 where id=$2 and revision=1 returning revision', ['Updated',id]);
    assert.equal(updated.rows[0].revision, 2);
    assert.equal((await db.query('update public.saved_assessments set title=$1 where id=$2 and revision=1 returning id', ['Stale',id])).rows.length, 0);
    await assert.rejects(db.query('update public.saved_assessments set user_id=$1 where id=$2', [bob,id]), {code:'42501'});
    await assert.rejects(db.query('update public.saved_assessments set revision=99 where id=$1', [id]), {code:'42501'});
    await assert.rejects(db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3)', [bob,'Other owner',payload]), {code:'42501'});
    await assert.rejects(db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3)', [alice,'Missing profile',JSON.stringify({version:5,activeProfileId:'assessment'})]), {code:'23514'});
    await assert.rejects(db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3)', [alice,' ',payload]), {code:'23514'});
    await asUser(bob);
    assert.equal((await db.query('select * from public.saved_assessments where id=$1', [id])).rows.length, 0);
    assert.equal((await db.query('update public.saved_assessments set title=$1 where id=$2 returning id', ['Intrusion',id])).rows.length, 0);
    assert.equal((await db.query('delete from public.saved_assessments where id=$1 returning id', [id])).rows.length, 0);
    const own = await db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3) returning id', [bob,'Bob',payload]);
    assert.equal((await db.query('delete from public.saved_assessments where id=$1 returning id', [own.rows[0].id])).rows.length, 1);
    await db.exec('reset role;');
    await db.query('delete from auth.users where id=$1', [alice]);
    assert.equal((await db.query('select * from public.saved_assessments')).rows.length, 0);
  } finally { await db.close(); }
});

test('account limits reject excess saves without exposing counters or changing saved data',
  { skip: !process.env.BCCSR_PGLITE_PATH }, async () => {
  const { PGlite } = require(process.env.BCCSR_PGLITE_PATH);
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public, auth to anon, authenticated;
      insert into auth.users values ('${alice}'),('${bob}');`);
    await db.exec(fs.readFileSync(require.resolve('../supabase/saved-assessments.sql'), 'utf8'));
    const limitsFile = require('node:path').join(__dirname, '../supabase/assessment-limits.sql');
    await db.exec(fs.readFileSync(limitsFile, 'utf8'));
    const asUser = async user => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    const payload = JSON.stringify({version:5,activeProfileId:'assessment',profiles:{assessment:{selectedContaminants:[],apecs:[]}}});
    const insert = user => db.query('insert into public.saved_assessments(user_id,title,payload) values ($1,$2,$3) returning id', [user,'Assessment',payload]);
    await asUser(alice);
    const id = (await insert(alice)).rows[0].id;
    for (let i = 1; i < 20; i++) await db.query('update public.saved_assessments set title=$1 where id=$2', [`Rename ${i}`,id]);
    await assert.rejects(insert(alice), {code:'PT429'});
    await assert.rejects(db.query('update public.saved_assessments set title=$1 where id=$2', ['Lost rename',id]), {code:'PT429'});
    assert.equal((await db.query('select title,revision from public.saved_assessments where id=$1',[id])).rows[0].title,'Rename 19');
    await assert.rejects(db.query('select * from bccsr_private.assessment_write_limits'), {code:'42501'});
    await assert.rejects(db.query('select bccsr_private.enforce_assessment_limits()'), {code:'42501'});
    await assert.rejects(insert(bob), {code:'42501'});
    await asUser(bob);
    await insert(bob);
    await db.exec('reset role');
    await db.query("update bccsr_private.assessment_write_limits set window_start=clock_timestamp()-interval '61 seconds' where user_id=$1",[alice]);
    await asUser(alice);
    await insert(alice);
    await db.exec('reset role');
    // Seed an existing full account without issuing a burst of client requests.
    await db.exec('alter table public.saved_assessments disable trigger enforce_assessment_limits');
    await db.query('insert into public.saved_assessments(user_id,title,payload) select $1,$2,$3::jsonb from generate_series(1,98)',[alice,'Existing',payload]);
    await db.exec('alter table public.saved_assessments enable trigger enforce_assessment_limits');
    await asUser(alice);
    await assert.rejects(insert(alice), {code:'PT409'});
    await db.query('update public.saved_assessments set title=$1 where id=$2',['At quota',id]);
    await db.query('delete from public.saved_assessments where id=$1',[id]);
    await insert(alice);
    assert.equal((await db.query('select count(*)::int as n from public.saved_assessments')).rows[0].n,100);
    await db.exec('reset role');
    await db.query('delete from auth.users where id=$1',[alice]);
    assert.equal((await db.query('select count(*)::int as n from bccsr_private.assessment_write_limits where user_id=$1',[alice])).rows[0].n,0);
  } finally { await db.close(); }
});
