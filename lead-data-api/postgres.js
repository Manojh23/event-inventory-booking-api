import pg from 'pg';
export async function connectPostgres() {
  const pool=new pg.Pool({
    ...(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL} : {}),
    max:5, connectionTimeoutMillis:5000,
  });
  pool.on('error',error=>console.error('Idle PostgreSQL connection failed:',error.message));
  return {
    query:(...args)=>pool.query(...args),
    exec:(sql)=>pool.query(sql),
    close:()=>pool.end(),
    async transaction(fn) {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const result=await fn({query:client.query.bind(client),exec:client.query.bind(client)});
        await client.query('COMMIT');
        return result;
      } catch(error) {await client.query('ROLLBACK');throw error;}
      finally {client.release();}
    },
  };
}
