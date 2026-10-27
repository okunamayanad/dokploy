import release from "../personal-release.json" with { type: "json" };

export const PERSONAL_VERSION = release.version;
export const PERSONAL_IMAGE = release.image;
export const PERSONAL_RELEASES_URL = `https://github.com/${release.repository}/releases`;
export const PERSONAL_MANIFEST_URL = `${PERSONAL_RELEASES_URL}/latest/download/release.json`;
export const PERSONAL_RELEASE_API_URL = `https://api.github.com/repos/${release.repository}/releases/latest`;

export const parsePersonalVersion = (version: string): number[] => {
	if (
		!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
	) {
		throw new Error(`Invalid personal release version: ${version}`);
	}
	const parts = version.replace(/^v/, "").split(".").map(Number);
	if (!parts.every(Number.isSafeInteger))
		throw new Error("Version component is too large");
	return parts;
};

export const comparePersonalVersions = (
	left: string,
	right: string,
): number => {
	const a = parsePersonalVersion(left);
	const b = parsePersonalVersion(right);
	for (let index = 0; index < 4; index++) {
		const difference = a[index]! - b[index]!;
		if (difference !== 0) return Math.sign(difference);
	}
	return 0;
};

export const personalImage = (version: string): string => {
	parsePersonalVersion(version);
	return `${PERSONAL_IMAGE}:v${version.replace(/^v/, "")}`;
};

export const fetchPersonalUpdate = async (currentVersion: string) => {
	parsePersonalVersion(currentVersion);
	let data: unknown;
	try {
		const response = await fetch(PERSONAL_MANIFEST_URL, {
			cache: "no-store",
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok)
			throw new Error(
				`Personal release lookup failed: HTTP ${response.status}`,
			);
		data = await response.json();
	} catch {
		// Some networks can reach the API but block GitHub's release asset CDN.
		const response = await fetch(PERSONAL_RELEASE_API_URL, {
			cache: "no-store",
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok)
			throw new Error(
				`Personal release lookup failed: HTTP ${response.status}`,
			);
		const published = await response.json();
		if (
			published.draft !== false ||
			published.prerelease !== false ||
			typeof published.body !== "string"
		) {
			throw new Error("Expected a published stable personal release");
		}
		const images = published.body
			.split("`")
			.filter((value: string) => value.startsWith(`${PERSONAL_IMAGE}:`));
		if (images.length !== 1)
			throw new Error(
				"Published release must identify exactly one pinned image",
			);
		data = { version: published.tag_name, image: images[0] };
	}
	if (
		!data ||
		typeof data !== "object" ||
		!("version" in data) ||
		!("image" in data)
	) {
		throw new Error("Invalid personal release manifest");
	}
	if (typeof data.version !== "string" || typeof data.image !== "string") {
		throw new Error("Invalid personal release manifest fields");
	}
	parsePersonalVersion(data.version);
	const prefix = `${personalImage(data.version)}@sha256:`;
	if (
		!data.image.startsWith(prefix) ||
		!/^[a-f0-9]{64}$/.test(data.image.slice(prefix.length))
	) {
		throw new Error(
			"Release image must belong to this fork and be pinned by digest",
		);
	}
	return {
		latestVersion: data.version,
		updateAvailable: comparePersonalVersions(data.version, currentVersion) > 0,
		image: data.image,
	};
};
