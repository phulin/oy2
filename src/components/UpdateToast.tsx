import { Button } from "@kobalte/core/button";
import "./ButtonStyles.css";
import "./UpdateToast.css";

type UpdateToastProps = {
	onRefresh: () => void;
};

export function UpdateToast(props: UpdateToastProps) {
	return (
		<div class="update-toast">
			<span>Update available</span>
			<Button class="btn-secondary" onClick={props.onRefresh}>
				Refresh
			</Button>
		</div>
	);
}
