import { isConfigured, submitRsvpUrl } from "./supabase.js";

const form = document.querySelector("#rsvp-form");
const message = document.querySelector("#form-message");
const companionsInput = document.querySelector("#companions");
const attendingInputs = [...document.querySelectorAll('input[name="attending"]')];
const params = new URLSearchParams(window.location.hash.slice(1));
const invitationToken = params.get("token");

if (window.location.hash) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = `notice ${kind}`.trim();
  message.hidden = false;
}

function selectedAttendance() {
  return attendingInputs.find((input) => input.checked)?.value;
}

function updateCompanionControl() {
  const attending = selectedAttendance() === "yes";
  companionsInput.disabled = !attending;
  if (!attending) companionsInput.value = "0";
}

attendingInputs.forEach((input) => input.addEventListener("change", updateCompanionControl));

if (!invitationToken || invitationToken === "REEMPLAZAR_CON_TOKEN_DE_INVITACION") {
  form.hidden = true;
  showMessage("Este enlace de invitación no es válido. Solicita a la persona organizadora un enlace personal.", "error");
} else if (!isConfigured) {
  form.hidden = true;
  showMessage("El formulario aún no está configurado. Inténtalo nuevamente más tarde.", "error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const attending = selectedAttendance() === "yes";
  const companions = attending ? Number(companionsInput.value) : 0;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage("Enviando tu respuesta…");

  try {
    const response = await fetch(submitRsvpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: invitationToken,
        first_name: form.elements.first_name.value.trim(),
        last_name: form.elements.last_name.value.trim(),
        attending,
        companions,
        comment: form.elements.comment.value.trim(),
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "No se pudo enviar la respuesta.");
    }

    form.hidden = true;
    showMessage("¡Gracias! Tu respuesta quedó registrada.", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "No se pudo enviar la respuesta. Inténtalo nuevamente.", "error");
    submitButton.disabled = false;
  }
});

updateCompanionControl();
