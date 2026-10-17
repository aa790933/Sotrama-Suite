import test from 'tape';
import { getQuickEditProps } from 'src/utils/quickEditRoute';

test('quick edit receives schema and document name from canonical route params', (t) => {
  const props = getQuickEditProps({
    params: { schemaName: 'Item', name: 'ITEM-0001' },
    query: { hideFields: ['itemCode'], showFields: ['itemName'] },
  });

  t.equal(props.schemaName, 'Item');
  t.equal(props.name, 'ITEM-0001');
  t.deepEqual(props.hideFields, ['itemCode']);
  t.deepEqual(props.showFields, ['itemName']);
  t.end();
});

test('quick edit preserves query props for routes without path params', (t) => {
  const props = getQuickEditProps({
    params: {},
    query: { schemaName: 'Item', name: 'ITEM-0002' },
  });

  t.equal(props.schemaName, 'Item');
  t.equal(props.name, 'ITEM-0002');
  t.end();
});
