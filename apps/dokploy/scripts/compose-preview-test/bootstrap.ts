import { docker } from "@dokploy/server/constants";
import { setupDirectories } from "@dokploy/server/setup/config-paths";
import { initializeSwarm } from "@dokploy/server/setup/setup";
import {
	createDefaultMiddlewares,
	createDefaultTraefikConfig,
	initializeStandaloneTraefik,
} from "@dokploy/server/setup/traefik-setup";

// The socket belongs to the disposable Docker-in-Docker service.
setupDirectories();
await initializeSwarm();
await docker
	.getNetwork("dokploy-network")
	.inspect()
	.catch(async () => {
		await docker.createNetwork({
			Name: "dokploy-network",
			Driver: "overlay",
			Attachable: true,
		});
	});
createDefaultTraefikConfig();
createDefaultMiddlewares();
const existing = await docker
	.getContainer("dokploy-traefik")
	.inspect()
	.catch(() => null);
if (!existing?.State.Running) await initializeStandaloneTraefik();
console.log("Isolated preview test installation initialized");
process.exit(0);
