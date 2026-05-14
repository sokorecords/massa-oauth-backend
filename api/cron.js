export default async function handler(req, res) {
  if (req.headers['x-vercel-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const response = await fetch('https://massa-oauth-backend.vercel.app/api/keep-alive');
    const data = await response.json();
    res.status(200).json({ message: 'Keep-alive executed', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
