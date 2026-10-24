import type { ComposeSpecification, DefinitionsService } from "../types";

const removeTraefikLabels = (labels: DefinitionsService["labels"]) => {
	const keep = (key: string) => {
		if (key.includes("$"))
			throw new Error(
				"Preview deployments do not support interpolated label keys",
			);
		return !key.trim().toLowerCase().startsWith("traefik.");
	};
	if (Array.isArray(labels))
		return labels.filter((label) => keep(label.split("=", 1)[0]!));
	return (
		labels &&
		Object.fromEntries(Object.entries(labels).filter(([key]) => keep(key)))
	);
};

const isProjectLocalPath = (source: string) =>
	!source.startsWith("/") &&
	!source.startsWith("\\") &&
	!source.startsWith("~") &&
	!source.includes("$") &&
	!/^[a-z]:/i.test(source) &&
	!source.split(/[\\/]/).includes("..");

/** Scope resources to the preview project before adding its routing labels. */
export const prepareComposePreview = (
	specification: ComposeSpecification,
	appName: string,
): ComposeSpecification => {
	const result = structuredClone(specification);
	if ("include" in result)
		throw new Error("Preview deployments do not support Compose include");
	result.name = appName;
	for (const [name, service] of Object.entries(result.services ?? {})) {
		if (service.extends)
			throw new Error("Preview deployments do not support Compose extends");
		if ("label_file" in service)
			throw new Error("Preview deployments do not support label_file");
		for (const reference of service.volumes_from ?? []) {
			const match = /^([a-zA-Z0-9._-]+)(?::(?:ro|rw))?$/.exec(reference);
			if (!match || !Object.hasOwn(result.services ?? {}, match[1]!)) {
				throw new Error(
					"Preview volumes_from may only reference services in this preview",
				);
			}
		}
		const envFiles = Array.isArray(service.env_file)
			? service.env_file
			: service.env_file
				? [service.env_file]
				: [];
		for (const envFile of envFiles) {
			const file = typeof envFile === "string" ? envFile : envFile.path;
			if (!file || !isProjectLocalPath(file))
				throw new Error("Preview env_file paths must be project-local");
		}
		delete service.container_name;
		delete service.ports;
		if (service.network_mode)
			throw new Error("Preview deployments do not support network_mode");
		service.labels = removeTraefikLabels(service.labels);
		if (service.deploy)
			service.deploy.labels = removeTraefikLabels(service.deploy.labels);
		if (service.build) {
			service.image = `${appName}-${name}`;
			if (typeof service.build !== "string") delete service.build.tags;
		}
		for (const volume of service.volumes ?? []) {
			// A single path is an anonymous container volume, not a host bind.
			if (typeof volume === "string" && !volume.includes(":")) continue;
			const source =
				typeof volume === "string" ? volume.split(":")[0] : volume.source;
			if (source && !isProjectLocalPath(source)) {
				throw new Error(
					"Preview deployments require project-local bind mounts or named volumes",
				);
			}
		}
	}
	for (const volume of Object.values(result.volumes ?? {})) {
		if (
			volume &&
			((volume.driver && volume.driver !== "local") ||
				Object.keys(volume.driver_opts ?? {}).length > 0)
		) {
			throw new Error(
				"Preview deployments do not support custom volume drivers or driver options",
			);
		}
	}
	for (const resources of [result.configs, result.secrets]) {
		for (const resource of Object.values(resources ?? {})) {
			if (resource?.file && !isProjectLocalPath(resource.file)) {
				throw new Error(
					"Preview config and secret files must be project-local",
				);
			}
		}
	}
	for (const [name, network] of Object.entries(result.networks ?? {})) {
		if (!network || name === appName) continue;
		delete network.external;
		delete network.name;
	}
	for (const resources of [result.volumes, result.configs, result.secrets]) {
		for (const resource of Object.values(resources ?? {})) {
			if (!resource) continue;
			if (resource.external)
				throw new Error("Preview deployments cannot share external resources");
			delete resource.name;
		}
	}
	return result;
};
