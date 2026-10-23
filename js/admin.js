import { isConfigured, supabase } from "./supabase.js";

const message = document.querySelector("#admin-message");
const emailLabel = document.querySelector("#organizer-email");
const eventSelect = document.querySelector("#event-select");
const searchInput = document.querySelector("#guest-search");
const guestList = document.querySelector("#guest-list");
const copyButton = document.querySelector("#copy-list");
const logoutButton = document.querySelector("#logout-button");

let invitations = [];

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = `notice ${kind}`.trim();
  message.hidden = false;
}

function setSummary({ yes = 0, no = 0, pending = 0, total = 0 } = {}) {
  document.querySelector("#count-yes").textContent = yes;
  document.querySelector("#count-no").textContent = no;
  document.querySelector("#count-pending").textContent = pending;
  document.querySelector("#count-total").textContent = total;
}

function responseLabel(response) {
  if (!response) return "Pendiente";
  return response.attending ? "Confirmada" : "Rechazada";
}

function getResponse(invitation) {
  const response = invitation.rsvps;
  return Array.isArray(response) ? response[0] || null : response || null;
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "—";
  return cell;
}

function renderInvitations() {
  const term = searchInput.value.trim().toLocaleLowerCase();
  const filtered = invitations.filter((invitation) => {
    const response = getResponse(invitation);
    const searchable = [
      invitation.first_name,
      invitation.last_name,
      response?.first_name,
      response?.last_name,
      response?.comment,
      responseLabel(response),
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(term);
  });

  guestList.replaceChildren();
  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-state";
    cell.textContent = invitations.length ? "No hay invitados que coincidan con la búsqueda." : "Este evento todavía no tiene invitaciones.";
    row.append(cell);
    guestList.append(row);
    return;
  }

  filtered.forEach((invitation) => {
    const response = getResponse(invitation);
    const row = document.createElement("tr");
    row.append(
      createCell(response
        ? `${response.first_name} ${response.last_name}`
        : `${invitation.first_name} ${invitation.last_name}`),
      createCell(responseLabel(response)),
      createCell(response?.attending ? String(response.companions) : "—"),
      createCell(response?.comment),
    );
    guestList.append(row);
  });
}

async function loadEvent(eventId) {
  setSummary();
  guestList.replaceChildren();
  const loadingRow = document.createElement("tr");
  const loadingCell = document.createElement("td");
  loadingCell.colSpan = 4;
  loadingCell.className = "empty-state";
  loadingCell.textContent = "Cargando invitados…";
  loadingRow.append(loadingCell);
  guestList.append(loadingRow);

  const { data, error } = await supabase
    .from("invitations")
    .select("id, first_name, last_name, rsvps(id, first_name, last_name, attending, companions, comment)")
    .eq("event_id", eventId)
    .order("last_name", { ascending: true });

  if (error) throw error;
  invitations = data;
  const yes = invitations.filter((item) => getResponse(item)?.attending).length;
  const no = invitations.filter((item) => {
    const response = getResponse(item);
    return response && !response.attending;
  }).length;
  setSummary({ yes, no, pending: invitations.length - yes - no, total: invitations.length });
  searchInput.disabled = false;
  copyButton.disabled = false;
  renderInvitations();
}

async function start() {
  if (!isConfigured) {
    showMessage("Configura la URL y la clave pública de Supabase antes de usar el panel.", "error");
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) {
    window.location.replace("login.html");
    return;
  }
  emailLabel.textContent = sessionData.session.user.email || "";

  const { data: events, error } = await supabase
    .from("events")
    .select("id, name")
    .order("created_at", { ascending: false });
  if (error) throw error;

  eventSelect.replaceChildren();
  if (!events.length) {
    eventSelect.add(new Option("No tienes eventos asignados", ""));
    showMessage("No hay eventos asignados a esta cuenta. Solicita a la persona administradora que vincule tu usuario.", "error");
    return;
  }

  events.forEach((event) => eventSelect.add(new Option(event.name, event.id)));
  eventSelect.disabled = false;
  searchInput.disabled = false;
  copyButton.disabled = false;
  await loadEvent(eventSelect.value);
}

eventSelect.addEventListener("change", async () => {
  try {
    await loadEvent(eventSelect.value);
    message.hidden = true;
  } catch (error) {
    showMessage(`No se pudo cargar el evento: ${error.message}`, "error");
  }
});

searchInput.addEventListener("input", renderInvitations);

copyButton.addEventListener("click", async () => {
  const lines = invitations.map((invitation) => {
    const response = getResponse(invitation);
    return [
      response ? `${response.first_name} ${response.last_name}` : `${invitation.first_name} ${invitation.last_name}`,
      responseLabel(response),
      response?.attending ? `Acompañantes: ${response.companions}` : "",
      response?.comment ? `Comentario: ${response.comment}` : "",
    ].filter(Boolean).join(" | ");
  });
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showMessage("Lista copiada al portapapeles.", "success");
  } catch (error) {
    showMessage(`No se pudo copiar la lista: ${error.message}`, "error");
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    logoutButton.disabled = false;
    showMessage(`No se pudo cerrar sesión: ${error.message}`, "error");
    return;
  }
  window.location.replace("login.html");
});

try {
  await start();
} catch (error) {
  showMessage(`No se pudo cargar el panel: ${error.message}`, "error");
}
