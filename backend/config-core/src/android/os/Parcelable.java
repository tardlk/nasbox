// Host-only declaration; Android service APIs are unavailable.
package android.os; public interface Parcelable {int describeContents();void writeToParcel(Parcel p,int flags);interface Creator<T>{T createFromParcel(Parcel p);T[] newArray(int n);}}
