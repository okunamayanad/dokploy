import release from "../personal-release.json" with { type: "json" };

export const PERSONAL_VERSION = release.version;
export const PERSONAL_IMAGE = release.image;
export const PERSONAL_RELEASES_URL = `https://github.com/${release.repository}/releases`;
export const PERSONAL_MANIFEST_URL = `${PERSONAL_RELEASES_URL}/latest/download/release.json`;

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
	const response = await fetch(PERSONAL_MANIFEST_URL, {
		cache: "no-store",
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok)
		throw new Error(`Personal release lookup failed: HTTP ${response.status}`);
	const data: unknown = await response.json();
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
