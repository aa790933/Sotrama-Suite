type QuickEditRoute = {
  params: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
};

export function getQuickEditProps(route: QuickEditRoute) {
  const props = { ...route.query };
  const schemaName = route.params.schemaName;
  const name = route.params.name;

  if (typeof schemaName === 'string') {
    props.schemaName = schemaName;
  }
  if (typeof name === 'string') {
    props.name = name;
  }

  return props;
}
