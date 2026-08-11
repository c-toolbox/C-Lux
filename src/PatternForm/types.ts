export interface CommonValues {
  name: string;
}

export interface SubFormProps<V extends CommonValues> {
  mode: 'add' | 'edit';
  initial: V;
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: V) => void;
}
