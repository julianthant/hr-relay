/** Whether `name` is a form the UCPath hire files and checks a person under: first last or last, first, with or without the middle name; only case and spacing may differ. */
export function isHireNameForm(employee: Readonly<{ firstName: string; middleName: string; lastName: string }>, name: string): boolean {
  const { firstName, middleName, lastName } = employee;
  const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
  return [`${firstName} ${lastName}`, `${lastName}, ${firstName}`, `${firstName} ${middleName} ${lastName}`, `${lastName}, ${firstName} ${middleName}`]
    .some(form => normalize(form) === normalize(name));
}
