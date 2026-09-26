import { RadioGroup, TextField } from '@/ui/form';

type Dog = {
  name?: string;
  breed?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  weightKg?: number | null;
  microchipNumber?: string | null;
  neutered?: boolean | null;
};

export function DogDetailsFields({ dog = {} }: { dog?: Dog }) {
  return (
    <>
      <TextField name="name" label="Dog’s name" required defaultValue={dog.name} autoComplete="off" />
      <TextField
        name="breed"
        label="Breed"
        hint="If you’re not sure, “cross breed” is fine"
        required
        defaultValue={dog.breed}
      />
      <RadioGroup
        name="sex"
        label="Sex"
        defaultValue={dog.sex}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
        ]}
      />
      <TextField
        name="dateOfBirth"
        label="Date of birth"
        type="date"
        hint="An estimate is fine for rescue dogs"
        required
        defaultValue={dog.dateOfBirth}
      />
      <TextField
        name="weightKg"
        label="Weight in kg"
        inputMode="decimal"
        type="text"
        required
        defaultValue={dog.weightKg}
      />
      <TextField
        name="microchipNumber"
        label="Microchip number"
        inputMode="numeric"
        hint="Usually 15 digits – it’s on your vet records"
        required
        defaultValue={dog.microchipNumber}
      />
      <RadioGroup
        name="neutered"
        label="Is your dog neutered or spayed?"
        defaultValue={dog.neutered == null ? undefined : dog.neutered ? 'yes' : 'no'}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
    </>
  );
}
