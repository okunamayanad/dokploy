import { dirname, isAbsolute, join } from "node:path";
import { quote } from "shell-quote";
import type { ComposeSpecification } from "../types";

/** Runs on the deployment host, so it resolves symlinks on local and SSH builds. */
export const getPreviewPathValidationCommand = (
	checkoutPath: string,
	paths: string[],
) => `
preview_root=$(realpath -e -- ${quote([checkoutPath])}) || exit 1;
for preview_path in ${quote([...new Set(paths)])}; do
  preview_target=$(realpath -m -- "$preview_path") || exit 1;
  case "$preview_target" in
    "$preview_root"|"$preview_root"/*) ;;
    *) echo 'Preview file path resolves outside its checkout' >&2; exit 1 ;;
  esac;
done;
`;

export const getPreviewComposePaths = (
	specification: ComposeSpecification,
	composePath: string,
) => {
	const base = dirname(composePath);
	const local = (path: string, directory = base) => {
		if (path.includes("$"))
			throw new Error(
				"Preview deployments do not support interpolated file paths",
			);
		return isAbsolute(path) ? path : join(directory, path);
	};
	if (composePath.includes("$"))
		throw new Error(
			"Preview deployments do not support interpolated file paths",
		);
	const paths = [composePath, join(base, ".env")];
	const isRemoteContext = (context: string) =>
		/^[a-z][a-z\d+.-]*:\/\//i.test(context) ||
		context.startsWith("git@") ||
		context.startsWith("service:");
	for (const service of Object.values(specification.services ?? {})) {
		const envFiles = Array.isArray(service.env_file)
			? service.env_file
			: service.env_file
				? [service.env_file]
				: [];
		for (const file of envFiles)
			paths.push(local(typeof file === "string" ? file : file.path));
		for (const volume of service.volumes ?? []) {
			if (typeof volume === "string") {
				if (!volume.includes(":")) continue;
				const source = volume.split(":")[0]!;
				if (
					source.startsWith(".") ||
					source.includes("/") ||
					source.includes("\\")
				)
					paths.push(local(source));
			} else if (volume.type === "bind" && volume.source)
				paths.push(local(volume.source));
		}
		if (service.build) {
			const build =
				typeof service.build === "string"
					? { context: service.build }
					: service.build;
			const context = build.context || ".";
			if (!isRemoteContext(context)) {
				const directory = local(context);
				paths.push(directory);
				if (build.dockerfile) paths.push(local(build.dockerfile, directory));
			}
			const contexts = Array.isArray(build.additional_contexts)
				? build.additional_contexts.map((entry) =>
						entry.slice(entry.indexOf("=") + 1),
					)
				: Object.values(build.additional_contexts ?? {});
			for (const context of contexts) {
				if (typeof context !== "string")
					throw new Error("Preview build contexts must be strings");
				if (!isRemoteContext(context)) paths.push(local(context));
			}
		}
	}
	for (const resources of [specification.configs, specification.secrets]) {
		for (const resource of Object.values(resources ?? {}))
			if (resource?.file) paths.push(local(resource.file));
	}
	return paths;
};
