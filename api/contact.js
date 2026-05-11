import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, phone, message } = req.body;

    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "aljaz.skornsek1@gmail.com",
      subject: "Novo sporočilo iz spletne strani",
      html: `
        <h2>Novo povpraševanje</h2>
        <p><strong>Ime:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>Sporočilo:</strong><br>${message}</p>
      `
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Napaka pri pošiljanju." });
  }
}