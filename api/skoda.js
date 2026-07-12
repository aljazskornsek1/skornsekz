export default async function handler(req, res) {
  res.status(501)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify({ error: 'V pripravi.' }))
}
