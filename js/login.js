import { isConfigured, supabase } from "./supabase.js";

const form = document.querySelector("#login-form");
const message = document.querySelector("#login-message");

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = `notice ${kind}`.trim();
  message.hidden = false;
}

if (!isConfigured) {
  form.hidden = true;
  showMessage("Configura la URL y la clave pública de Supabase antes de iniciar sesión.", "error");
} else {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showMessage(`No se pudo comprobar la sesión: ${error.message}`, "error");
  } else if (data.session) {
    window.location.replace("admin.html");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isConfigured || !form.reportValidity()) return;

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage("Iniciando sesión…");

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    if (error) throw error;
    window.location.replace("admin.html");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.", "error");
    button.disabled = false;
  }
});
