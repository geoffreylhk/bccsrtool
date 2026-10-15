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
