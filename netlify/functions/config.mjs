// Hands the browser the two public Supabase settings, so nothing has to be typed into the site code.
// The anon key is designed to be public; row-level security in the database is what protects the data.
export default async () => {
  const body = { url: process.env.SUPABASE_URL || null, anonKey: process.env.SUPABASE_ANON_KEY || null };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
export const config = { path: '/api/config' };
