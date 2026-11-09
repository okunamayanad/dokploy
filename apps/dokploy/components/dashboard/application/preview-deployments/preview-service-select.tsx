import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export const PreviewServiceSelect = ({
	services,
	value,
	onChange,
}: {
	services?: string[];
	value?: string;
	onChange: (value: string) => void;
}) => {
	if (!services?.length)
		return (
			<FormControl>
				<Input
					value={value || ""}
					onChange={(event) => onChange(event.target.value)}
					placeholder="Service name"
				/>
			</FormControl>
		);
	return (
		<Select value={value || ""} onValueChange={onChange}>
			<FormControl>
				<SelectTrigger>
					<SelectValue placeholder="Select a service" />
				</SelectTrigger>
			</FormControl>
			<SelectContent>
				{Array.from(new Set([...services, ...(value ? [value] : [])])).map(
					(service) => (
						<SelectItem key={service} value={service}>
							{service}
						</SelectItem>
					),
				)}
			</SelectContent>
		</Select>
	);
};
