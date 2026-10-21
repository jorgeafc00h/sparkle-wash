import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { DemoApi } from "../lib/demo";
import { AdminView } from "../views/Admin";
import { renderWith } from "./render";

function admin(api: DemoApi, section = "camaras") {
  return renderWith(api, <AdminView section={section} onSection={() => {}} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Administración > Cámaras", () => {
  it("lists linked cameras with their status", async () => {
    admin(new DemoApi());
    const card = await screen.findByRole("article", { name: "Cámara de salida" });
    expect(within(card).getByText("exit-cam")).toBeInTheDocument();
    expect(within(card).getByText("Salida")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toHaveTextContent("En línea");
    expect(within(card).getByText("-71 dBm")).toBeInTheDocument();
  });

  it("links a camera and shows its key exactly once, with the gateway command", async () => {
    const api = new DemoApi({ seed: false, tenant: { name: "Lavado Nuevo" } });
    admin(api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Vincular cámara" }));
    const dialog = screen.getByRole("dialog", { name: "Vincular una ESP32-CAM" });
    expect(within(dialog).getByRole("radio", { name: "Entrada" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("ID de cámara")).toHaveValue("entrance-cam");
    await user.click(within(dialog).getByRole("button", { name: "Crear llave" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Nombre de 2 a 60 caracteres");
    await user.type(within(dialog).getByLabelText("Nombre"), "Portón principal");
    await user.click(within(dialog).getByRole("button", { name: "Crear llave" }));

    const keyDialog = await screen.findByRole("dialog", { name: "Llave de Portón principal" });
    const key = within(keyDialog).getByLabelText("Llave").textContent!;
    expect(key).toMatch(/^swd\.demo\.[a-z0-9]+\.[A-Za-z0-9]{43}$/);
    expect(within(keyDialog).getByLabelText("Comando del gateway").textContent).toContain(`--device-key ${key}`);
    expect(within(keyDialog).getByLabelText("Comando del gateway").textContent).toContain("--camera-id entrance-cam");
    // The key dialog can't be dismissed by accident.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Llave de Portón principal" })).toBeInTheDocument();
    await user.click(within(keyDialog).getByRole("button", { name: "Ya la guardé" }));

    const card = await screen.findByRole("article", { name: "Portón principal" });
    expect(within(card).getByRole("status")).toHaveTextContent("Esperando la primera conexión");
    expect(document.body.textContent).not.toContain(key);
    expect(within(card).getByText(`…${key.slice(-4)}`)).toBeInTheDocument();
  });

  it("refuses a second active camera with the same id", async () => {
    admin(new DemoApi());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Vincular cámara" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nombre"), "Otra entrada");
    await user.clear(within(dialog).getByLabelText("ID de cámara"));
    await user.type(within(dialog).getByLabelText("ID de cámara"), "entrance-cam");
    await user.click(within(dialog).getByRole("button", { name: "Crear llave" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Alguien ya cambió esto/);
  });
});

describe("Administración > Equipo y Empleados", () => {
  it("invites by email, validates it, and protects the last admin", async () => {
    const api = new DemoApi();
    admin(api, "equipo");
    const user = userEvent.setup();
    const email = await screen.findByLabelText("Correo de Google");
    await user.type(email, "no-es-correo");
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    expect(screen.getByText("Escribe un correo válido.")).toBeInTheDocument();
    await user.clear(email);
    await user.type(email, "Pedro@Ejemplo.com");
    await user.click(screen.getByRole("radio", { name: /Administrador/ }));
    await user.click(screen.getByRole("button", { name: "Invitar" }));
    await screen.findByText("Invitación creada para pedro@ejemplo.com");
    expect((await api.team()).invitations[0]).toMatchObject({ email: "pedro@ejemplo.com", role: "admin" });

    await user.selectOptions(screen.getByLabelText("Rol de Tú (demo)"), "operator");
    expect(await screen.findByText(/Alguien ya cambió esto/)).toBeInTheDocument();
    expect((await api.team()).members.find((m) => m.subject === "demo")?.role).toBe("admin");
  });

  it("adds wash employees who can then be assigned to jobs", async () => {
    const api = new DemoApi({ seed: false });
    admin(api, "empleados");
    const user = userEvent.setup();
    expect(await screen.findByText("Aún no hay empleados.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nombre del empleado"), "Rosa Méndez");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await screen.findByText("Rosa Méndez agregado");
    expect((await api.employees()).map((e) => e.name)).toEqual(["Rosa Méndez"]);
  });
});

describe("registration and sessions", () => {
  it("registers a carwash in the demo and lands on its setup checklist", async () => {
    window.history.replaceState(null, "", "/app/?registro=1");
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Registra tu autolavado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Probar el registro en la demo" }));
    expect(screen.getByText("Escribe un nombre de 2 a 80 caracteres.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nombre del autolavado"), "Lavado La Ceiba");
    await user.selectOptions(screen.getByLabelText("País"), "HN");
    expect(screen.getByLabelText("Zona horaria")).toHaveValue("America/Tegucigalpa");
    await user.type(screen.getByLabelText("Teléfono (opcional)"), "abc");
    await user.click(screen.getByRole("button", { name: "Probar el registro en la demo" }));
    expect(screen.getByText(/Teléfono: de 6 a 24 caracteres/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Teléfono (opcional)"));
    await user.click(screen.getByRole("button", { name: "Probar el registro en la demo" }));

    expect(await screen.findByText("¡Bienvenido a SparkleWash, Lavado La Ceiba!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vincula la cámara de la entrada/ })).toBeInTheDocument();
    expect(screen.getAllByText("Lavado La Ceiba").length).toBeGreaterThan(0);
  });

  it("goes back to sign-in when the session expires", async () => {
    sessionStorage.setItem("sparklewash.session", "expired-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })));
    window.history.replaceState(null, "", "/app/");
    render(<App />);
    expect(await screen.findByText("Tu sesión terminó. Vuelve a iniciar sesión.")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("sparklewash.session")).toBeNull());
  });

  it("only admins see Administración", async () => {
    window.history.replaceState(null, "", "/app/?demo=1");
    render(<App />);
    expect(await screen.findAllByRole("link", { name: /Administración/ })).not.toHaveLength(0);
  });
});
