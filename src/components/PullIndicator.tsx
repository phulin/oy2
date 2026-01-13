import "./PullIndicator.css";

type PullIndicatorProps = {
	active: boolean;
	refreshing: boolean;
};

export function PullIndicator(props: PullIndicatorProps) {
	return (
		<div
			id="pull-indicator"
			classList={{ active: props.active, refreshing: props.refreshing }}
		/>
	);
}
